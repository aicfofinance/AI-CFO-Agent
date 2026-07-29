/**
 * POST /api/connections/csv — Upload a QuickBooks Transaction Detail Report CSV
 * and import its transactions into the `transactions` table.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if no org membership,
 * 400 for validation failures, 422 if the CSV contains no valid rows, 201 on
 * success.
 *
 * Processing order (AGENTS.md integration handoff protocol):
 *   1. getRequestContext() → orgId, userId
 *   2. Parse multipart form-data, extract the `file` field
 *   3. Validate: file present, CSV type/extension, ≤ 10 MB
 *   4. Read file text → parseQBCSV() → normalizeCSVRow() for each row
 *   5. If 0 valid rows → 422 CSV_NO_VALID_ROWS
 *   6. Upsert into `transactions` (batch, onConflictDoUpdate on orgId+sourceSystem+externalId)
 *      Log unmapped categories ('other' with non-null source) to data_quality_log
 *   7. Upsert `connections` row (provider='csv') → get connectionId
 *   8. Insert `sync_jobs` row (status='completed', recordsSynced=N)
 *   9. Return 201 { data: { rowsImported, connectionId } }
 *
 * OAuth token note: CSV connections have no real OAuth token. A placeholder
 * value is encrypted with `encryptToken()` and stored in `access_token_encrypted`
 * (the column is NOT NULL). The encrypted placeholder satisfies the column
 * constraint while following CLAUDE.md's rule that every stored token value must
 * pass through `encryptToken()`.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { connections, dataQualityLog, syncJobs, transactions } from "@/lib/platform/db/schema";
import { encryptToken } from "@/lib/platform/security/encryption";
import { parseQBCSV } from "@/lib/integrations/csv/parser";
import { normalizeCSVRow } from "@/lib/integrations/csv/normalize";

/** Maximum accepted file size for a CSV upload (10 MB). */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    // ── 1. Establish org context ──────────────────────────────────────────────
    const { orgId } = await getRequestContext(request);

    // ── 2. Parse multipart form-data ─────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "Expected multipart/form-data.",
            request_id,
          },
        },
        { status: 400 },
      );
    }

    const file = formData.get("file");

    // ── 3. Validate the uploaded file ─────────────────────────────────────────
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            code: "CSV_FILE_MISSING",
            message: "A file field named 'file' is required.",
            request_id,
          },
        },
        { status: 400 },
      );
    }

    const isCsvType = file.type === "text/csv" || file.type === "application/csv";
    const isCsvExtension = file.name.toLowerCase().endsWith(".csv");
    if (!isCsvType && !isCsvExtension) {
      return NextResponse.json(
        {
          error: {
            code: "CSV_INVALID_TYPE",
            message: "Only CSV files are accepted. Ensure the file has a .csv extension.",
            request_id,
          },
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: "CSV_FILE_TOO_LARGE",
            message: "File exceeds the 10 MB size limit.",
            request_id,
          },
        },
        { status: 400 },
      );
    }

    // ── 4. Parse and normalize ────────────────────────────────────────────────
    const csvText = await file.text();
    const parsedRows = parseQBCSV(csvText);

    const normalizedRows = parsedRows
      .map((row) => normalizeCSVRow(row))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    // ── 5. Guard: no valid rows ───────────────────────────────────────────────
    if (normalizedRows.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "CSV_NO_VALID_ROWS",
            message: "No valid transactions found in CSV.",
            request_id,
          },
        },
        { status: 422 },
      );
    }

    // ── 6. Upsert transactions ────────────────────────────────────────────────
    // Build the insert rows array; log unmapped categories to data_quality_log.
    const insertRows: (typeof transactions.$inferInsert)[] = [];

    for (const norm of normalizedRows) {
      // Log unmapped categories when a source name was available.
      if (norm.category === "other" && norm.categorySource !== null) {
        await db.insert(dataQualityLog).values({
          orgId,
          sourceSystem: "csv",
          issueType: "unmapped_category",
          issueDetail:
            `CSV transaction ${norm.externalId}: account name "${norm.categorySource}" ` +
            "did not match any internal category; stored as 'other'",
        });
      }

      insertRows.push({
        orgId,
        externalId: norm.externalId,
        sourceSystem: "csv",
        transactionDate: norm.transactionDate,
        amount: norm.amount,
        currencyCode: norm.currencyCode,
        amountBase: null, // multi-currency out of V1 scope
        transactionType: norm.transactionType,
        category: norm.category,
        subcategory: null,
        description: norm.description,
        vendorName: norm.vendorName,
        accountId: null, // CSV imports have no Chart of Accounts reference
        referenceNumber: norm.referenceNumber,
        isReconciled: norm.isReconciled,
        rawData: null, // never store raw upload data — may contain customer PII
        updatedAt: new Date(),
      });
    }

    await db
      .insert(transactions)
      .values(insertRows)
      .onConflictDoUpdate({
        target: [transactions.orgId, transactions.sourceSystem, transactions.externalId],
        set: {
          transactionDate: sql`excluded.transaction_date`,
          amount: sql`excluded.amount`,
          currencyCode: sql`excluded.currency_code`,
          transactionType: sql`excluded.transaction_type`,
          category: sql`excluded.category`,
          subcategory: sql`excluded.subcategory`,
          description: sql`excluded.description`,
          vendorName: sql`excluded.vendor_name`,
          referenceNumber: sql`excluded.reference_number`,
          isReconciled: sql`excluded.is_reconciled`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    const rowsImported = insertRows.length;

    // ── 7. Upsert connections row ─────────────────────────────────────────────
    // CSV connections have no OAuth token. A placeholder is encrypted so the
    // NOT NULL `access_token_encrypted` column is satisfied per CLAUDE.md rules
    // (every stored token value must pass through encryptToken()).
    const placeholderToken = encryptToken("csv-no-oauth-token");
    const now = new Date();

    const connectionResult = await db
      .insert(connections)
      .values({
        orgId,
        provider: "csv",
        accessTokenEncrypted: placeholderToken,
        refreshTokenEncrypted: null,
        tokenExpiry: null,
        realmId: null,
        providerCompanyName: "CSV Upload",
        currencyCode: "USD",
        isActive: true,
        lastSyncedAt: now,
        syncStatus: "success",
        syncErrorMessage: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider],
        set: {
          isActive: true,
          syncStatus: "success",
          lastSyncedAt: now,
          syncErrorMessage: null,
          updatedAt: now,
        },
      })
      .returning({ id: connections.id });

    const connectionRow = connectionResult[0];
    if (!connectionRow) {
      console.error({ event: "csv_upload_connection_upsert_failed", orgId, request_id });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
            request_id,
          },
        },
        { status: 500 },
      );
    }

    const connectionId = connectionRow.id;

    // ── 8. Create sync_jobs row ───────────────────────────────────────────────
    await db.insert(syncJobs).values({
      orgId,
      connectionId,
      jobType: "csv_upload",
      status: "completed",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      recordsSynced: rowsImported,
      recordsSkipped: parsedRows.length - rowsImported,
    });

    console.log({
      event: "csv_upload_complete",
      orgId,
      connectionId,
      rowsImported,
      totalParsed: parsedRows.length,
      request_id,
    });

    // ── 9. Return 201 ─────────────────────────────────────────────────────────
    return NextResponse.json({ data: { rowsImported, connectionId } }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({
        event: "csv_upload_auth_failed",
        code: error.code,
        request_id,
      });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "csv_upload_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id,
        },
      },
      { status: 500 },
    );
  }
}
