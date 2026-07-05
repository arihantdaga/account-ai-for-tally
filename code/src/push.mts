import { XMLParser } from 'fast-xml-parser';
import type * as m from './models.mjs';
import { postTallyXML } from './tally.mjs';
import { utility } from './utility.mjs';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toTallyDate(isoDate: string): string {
  // Convert YYYY-MM-DD to DD-MMM-YYYY (the format Tally accepts in cancel envelope DATE attribute)
  const [year, month, day] = isoDate.split('-');
  return `${day}-${MONTHS[parseInt(month, 10) - 1]}-${year}`;
}

const esc = utility.String.escapeHTML;

function parsePushResponse(xmlResponse: string): m.ModelPushResponse {
  try {
    if (!xmlResponse || xmlResponse.trim() === '') {
      return { success: false, error: 'Empty response from Tally' };
    }

    const parser = new XMLParser({ parseTagValue: false });
    const result = parser.parse(xmlResponse);

    const response =
      result?.RESPONSE || result?.ENVELOPE?.BODY?.DATA?.IMPORTRESULT || result;

    const created = parseInt(response?.CREATED || '0', 10);
    const altered = parseInt(response?.ALTERED || '0', 10);
    const deleted = parseInt(response?.DELETED || '0', 10);
    const cancelled = parseInt(response?.CANCELLED || '0', 10);
    const lineError = response?.LINEERROR;

    const total = created + altered + deleted + cancelled;

    if (total > 0) {
      return { success: true, created, altered, deleted, cancelled };
    }

    const errorMsg = lineError || response?.ERRORMSG || '';
    return {
      success: false,
      created,
      altered,
      deleted,
      cancelled,
      error: errorMsg || 'Operation failed - no records affected',
    };
  } catch (_err) {
    return { success: false, error: 'Failed to parse Tally response' };
  }
}

function buildImportEnvelope(
  companyName: string | undefined,
  reportName: string,
  tallyMessageContent: string,
): string {
  const companyElement = companyName
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : '';

  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY>
<IMPORTDATA>
<REQUESTDESC>
<REPORTNAME>${reportName}</REPORTNAME>
${companyElement}
</REQUESTDESC>
<REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
${tallyMessageContent}
</TALLYMESSAGE>
</REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>`;
}

// --- Master XML Builders ---

// Tally stores a ledger opening balance as a signed amount where Debit is
// negative and Credit is positive, but the import XML expects the human form
// "<magnitude> Dr" / "<magnitude> Cr". We accept a positive magnitude plus an
// explicit Dr/Cr type (default Dr, the common case for assets/debtors/expenses).
// A value of 0 is honoured (it clears an existing opening balance).
function buildOpeningBalanceXML(params: Record<string, any>): string {
  const raw = params.openingBalance;
  if (raw === undefined || raw === null || raw === '') return '';
  const num = Number(raw);
  if (Number.isNaN(num)) return '';
  const magnitude = Math.abs(num);
  const type = /^c/i.test(String(params.openingBalanceType ?? '')) ? 'Cr' : 'Dr';
  return `<OPENINGBALANCE>${magnitude} ${type}</OPENINGBALANCE>`;
}

function buildCreateLedgerXML(params: Record<string, any>): string {
  const name = esc(params.name);
  const parent = params.parent ? `<PARENT>${esc(params.parent)}</PARENT>` : '';
  const address = params.address
    ? `<ADDRESS>${esc(params.address)}</ADDRESS>`
    : '';
  const country = params.country
    ? `<COUNTRYOFRESIDENCE>${esc(params.country)}</COUNTRYOFRESIDENCE>`
    : '';
  const state = params.state
    ? `<LEDSTATENAME>${esc(params.state)}</LEDSTATENAME>`
    : '';
  const mobile = params.mobile
    ? `<LEDGERMOBILE>${esc(params.mobile)}</LEDGERMOBILE>`
    : '';
  const gstin = params.gstin
    ? `<PARTYGSTIN>${esc(params.gstin)}</PARTYGSTIN>`
    : '';
  const openingBalance = buildOpeningBalanceXML(params);

  return `<LEDGER Action="Create">
<NAME>${name}</NAME>
${parent}${address}${country}${state}${mobile}${gstin}${openingBalance}
</LEDGER>`;
}

// Alter an existing ledger. Identified by the NAME attribute; every child tag is
// optional so callers can change just the opening balance (the primary use case)
// or any subset of the master fields. Confirmed against a live Tally: sending
// only <OPENINGBALANCE> returns ALTERED=1 and leaves all other fields intact.
function buildUpdateLedgerXML(params: Record<string, any>): string {
  const elements: string[] = [];
  if (params.parent) elements.push(`<PARENT>${esc(params.parent)}</PARENT>`);
  if (params.address)
    elements.push(`<ADDRESS>${esc(params.address)}</ADDRESS>`);
  if (params.country)
    elements.push(`<COUNTRYOFRESIDENCE>${esc(params.country)}</COUNTRYOFRESIDENCE>`);
  if (params.state)
    elements.push(`<LEDSTATENAME>${esc(params.state)}</LEDSTATENAME>`);
  if (params.mobile)
    elements.push(`<LEDGERMOBILE>${esc(params.mobile)}</LEDGERMOBILE>`);
  if (params.gstin)
    elements.push(`<PARTYGSTIN>${esc(params.gstin)}</PARTYGSTIN>`);
  const openingBalance = buildOpeningBalanceXML(params);
  if (openingBalance) elements.push(openingBalance);

  return `<LEDGER NAME="${esc(params.ledgerName)}" Action="Alter">
${elements.join('\n')}
</LEDGER>`;
}

function buildDeleteLedgerXML(params: Record<string, any>): string {
  return `<LEDGER NAME="${esc(params.ledgerName)}" ACTION="DELETE">
<NAME>${esc(params.ledgerName)}</NAME>
</LEDGER>`;
}

function buildCreateGroupXML(params: Record<string, any>): string {
  const billWise =
    params.enableBillWise !== undefined
      ? `<ISBILLWISEON>${params.enableBillWise ? 'Yes' : 'No'}</ISBILLWISEON>`
      : '';
  const addable =
    params.isAddable !== undefined
      ? `<ISADDABLE>${params.isAddable ? 'Yes' : 'No'}</ISADDABLE>`
      : '';

  return `<GROUP Action="Create">
<NAME>${esc(params.groupName)}</NAME>
<PARENT>${esc(params.parentGroup)}</PARENT>
${billWise}${addable}
</GROUP>`;
}

function buildUpdateGroupXML(params: Record<string, any>): string {
  const elements: string[] = [];
  if (params.parentGroup)
    elements.push(`<PARENT>${esc(params.parentGroup)}</PARENT>`);
  if (params.enableBillWise !== undefined)
    elements.push(
      `<ISBILLWISEON>${params.enableBillWise ? 'Yes' : 'No'}</ISBILLWISEON>`,
    );
  if (params.isAddable !== undefined)
    elements.push(`<ISADDABLE>${params.isAddable ? 'Yes' : 'No'}</ISADDABLE>`);

  return `<GROUP NAME="${esc(params.groupName)}" ACTION="Alter">
${elements.join('\n')}
</GROUP>`;
}

function buildDeleteGroupXML(params: Record<string, any>): string {
  return `<GROUP NAME="${esc(params.groupName)}" ACTION="DELETE">
<NAME>${esc(params.groupName)}</NAME>
</GROUP>`;
}

function buildCreateStockItemXML(params: Record<string, any>): string {
  const name = esc(params.name);
  const baseUnit = esc(params.baseUnit);
  const openingBalance =
    params.openingBalance !== undefined
      ? `<OPENINGBALANCE>${params.openingBalance}</OPENINGBALANCE>`
      : '';

  let gstDetails = '';
  if (params.hsnCode && params.gstRate !== undefined) {
    const halfRate = params.gstRate / 2;
    gstDetails = `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
<GSTDETAILS.LIST>
<APPLICABLEFROM>20200401</APPLICABLEFROM>
<CALCULATIONTYPE>On Value</CALCULATIONTYPE>
<HSNCODE>${esc(params.hsnCode)}</HSNCODE>
<TAXABILITY>Taxable</TAXABILITY>
<STATEWISEDETAILS.LIST>
<STATENAME>&#4; Any</STATENAME>
<RATEDETAILS.LIST>
<GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>
<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
<GSTRATE>${halfRate}</GSTRATE>
</RATEDETAILS.LIST>
<RATEDETAILS.LIST>
<GSTRATEDUTYHEAD>State Tax</GSTRATEDUTYHEAD>
<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
<GSTRATE>${halfRate}</GSTRATE>
</RATEDETAILS.LIST>
<RATEDETAILS.LIST>
<GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
<GSTRATE>${params.gstRate}</GSTRATE>
</RATEDETAILS.LIST>
<RATEDETAILS.LIST>
<GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD>
<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
</RATEDETAILS.LIST>
</STATEWISEDETAILS.LIST>
</GSTDETAILS.LIST>`;
  }

  return `<STOCKITEM Action="Create">
<NAME>${name}</NAME>
<BASEUNITS>${baseUnit}</BASEUNITS>
${openingBalance}${gstDetails}
</STOCKITEM>`;
}

function buildDeleteStockItemXML(params: Record<string, any>): string {
  return `<STOCKITEM NAME="${esc(params.stockItemName)}" ACTION="DELETE">
<NAME>${esc(params.stockItemName)}</NAME>
</STOCKITEM>`;
}

function buildCreateUnitXML(params: Record<string, any>): string {
  const isSimple = params.isSimpleUnit ? 'Yes' : 'No';
  return `<UNIT Action="Create">
<ISSIMPLEUNIT>${isSimple}</ISSIMPLEUNIT>
<NAME>${esc(params.name)}</NAME>
</UNIT>`;
}

function buildDeleteUnitXML(params: Record<string, any>): string {
  return `<UNIT NAME="${esc(params.unitName)}" ACTION="DELETE">
<NAME>${esc(params.unitName)}</NAME>
</UNIT>`;
}

// --- Voucher XML Builders ---

function buildCreateVoucherXML(params: Record<string, any>): string {
  const voucherType = esc(params.voucherType);
  // Convert YYYY-MM-DD to YYYYMMDD
  const date = params.date.replace(/-/g, '');
  const narration = params.narration
    ? `<NARRATION>${esc(params.narration)}</NARRATION>`
    : '';
  const partyLedger = params.partyLedger
    ? `<PARTYLEDGERNAME>${esc(params.partyLedger)}</PARTYLEDGERNAME>`
    : '';

  const entries = (params.ledgerEntries as m.VoucherLedgerEntry[])
    .map((entry) => {
      const isDeemedPositive = entry.isDeemedPositive ? 'Yes' : 'No';
      return `<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${esc(entry.ledgerName)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>
<AMOUNT>${entry.amount}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`;
    })
    .join('\n');

  return `<VOUCHER VCHTYPE="${voucherType}" ACTION="Create">
<DATE>${date}</DATE>
<VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>
${partyLedger}
${narration}
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
${entries}
</VOUCHER>`;
}

function buildCancelVoucherXML(params: Record<string, any>): string {
  // MasterID is globally unique across voucher types. VoucherNumber is NOT unique
  // (multiple voucher types can share the same number) and VCHTYPE is not honored
  // as a filter — Tally will silently cancel the wrong voucher if we use VoucherNumber.
  const date = toTallyDate(params.date);
  const voucherType = esc(params.voucherType || '');
  const masterId = esc(params.masterId || '');
  return `<VOUCHER DATE="${date}" TAGNAME="MasterID" TAGVALUE="${masterId}" ACTION="Cancel" VCHTYPE="${voucherType}">
<NARRATION>Cancelled via API</NARRATION>
</VOUCHER>`;
}

function buildCancelEnvelope(companyName: string | undefined, voucherXML: string): string {
  const companyTag = companyName
    ? `<SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY>`
    : '';
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Import</TALLYREQUEST>
<TYPE>Data</TYPE>
<ID>Vouchers</ID>
</HEADER>
<BODY>
<DESC>${companyTag}</DESC>
<DATA>
<TALLYMESSAGE>
${voucherXML}
</TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>`;
}

// Generic master deletion. The Tally XML tag is the collection name in upper
// case (GROUP, LEDGER, STOCKITEM, …). Deletes one or more masters of a single
// type; each is emitted as its own <TAG NAME=".." ACTION="Delete"> element.
// A master only deletes if it has no dependent transactions/children.
const DELETE_MASTER_TAGS: Record<string, string> = {
  group: 'GROUP',
  ledger: 'LEDGER',
  vouchertype: 'VOUCHERTYPE',
  unit: 'UNIT',
  godown: 'GODOWN',
  stockgroup: 'STOCKGROUP',
  stockitem: 'STOCKITEM',
  costcategory: 'COSTCATEGORY',
  costcentre: 'COSTCENTRE',
  currency: 'CURRENCY',
};

function buildDeleteMasterXML(params: Record<string, any>): string {
  const collection = String(params.collection ?? '').toLowerCase();
  const tag = DELETE_MASTER_TAGS[collection];
  if (!tag) {
    throw new Error(
      `Unsupported collection '${params.collection}' for delete-master. Use one of: ${Object.keys(DELETE_MASTER_TAGS).join(', ')}`,
    );
  }
  const rawNames = Array.isArray(params.name) ? params.name : [params.name];
  const names = rawNames
    .filter((n) => n != null && String(n).trim() !== '')
    .map((n) => String(n));
  if (names.length === 0) {
    throw new Error('delete-master requires at least one name');
  }
  return names
    .map(
      (n) => `<${tag} NAME="${esc(n)}" ACTION="Delete"><NAME>${esc(n)}</NAME></${tag}>`,
    )
    .join('\n');
}

// --- Main Handler ---

const masterOperations = new Set([
  'create-ledger',
  'update-ledger',
  'delete-ledger',
  'create-group',
  'update-group',
  'delete-group',
  'create-stock-item',
  'delete-stock-item',
  'create-unit',
  'delete-unit',
  'delete-master',
]);

const voucherOperations = new Set(['create-voucher', 'cancel-voucher']);

const xmlBuilders: Record<string, (params: Record<string, any>) => string> = {
  'create-ledger': buildCreateLedgerXML,
  'update-ledger': buildUpdateLedgerXML,
  'delete-ledger': buildDeleteLedgerXML,
  'create-group': buildCreateGroupXML,
  'update-group': buildUpdateGroupXML,
  'delete-group': buildDeleteGroupXML,
  'create-stock-item': buildCreateStockItemXML,
  'delete-stock-item': buildDeleteStockItemXML,
  'create-unit': buildCreateUnitXML,
  'delete-unit': buildDeleteUnitXML,
  'delete-master': buildDeleteMasterXML,
  'create-voucher': buildCreateVoucherXML,
  'cancel-voucher': buildCancelVoucherXML,
};

export async function handlePush(
  operation: string,
  params: Record<string, any>,
): Promise<m.ModelPushResponse> {
  try {
    const builder = xmlBuilders[operation];
    if (!builder) {
      return { success: false, error: `Unknown operation: ${operation}` };
    }

    // Validate voucher-specific requirements
    if (operation === 'create-voucher') {
      if (
        !params.ledgerEntries ||
        !Array.isArray(params.ledgerEntries) ||
        params.ledgerEntries.length < 2
      ) {
        return {
          success: false,
          error:
            'Voucher requires at least 2 ledger entries (debit and credit)',
        };
      }
      if (!params.date || !/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        return { success: false, error: 'Date must be in YYYY-MM-DD format' };
      }
    }

    const targetCompany = params.targetCompany || undefined;
    const innerXML = builder(params);
    let fullXML: string;
    if (operation === 'cancel-voucher') {
      fullXML = buildCancelEnvelope(targetCompany, innerXML);
    } else {
      const reportName = voucherOperations.has(operation) ? 'Vouchers' : 'All Masters';
      fullXML = buildImportEnvelope(targetCompany, reportName, innerXML);
    }
    const response = await postTallyXML(fullXML);
    const parsed = parsePushResponse(response);
    // For cancel-voucher, Tally reports successful cancellation as ALTERED=1
    // (not CANCELLED=1, which is reserved for "create cancelled voucher" flows).
    // Surface this to the user as "cancelled" since that matches their intent.
    if (operation === 'cancel-voucher' && parsed.success && parsed.altered) {
      return {
        success: true,
        cancelled: parsed.altered,
        created: 0,
        altered: 0,
        deleted: 0,
      };
    }
    return parsed;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Push operation failed' };
  }
}
