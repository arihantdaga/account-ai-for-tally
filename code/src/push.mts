import { XMLParser } from 'fast-xml-parser';
import type * as m from './models.mjs';
import { postTallyXML } from './tally.mjs';
import { utility } from './utility.mjs';

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

  return `<LEDGER Action="Create">
<NAME>${name}</NAME>
${parent}${address}${country}${state}${mobile}${gstin}
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
  const voucherType = params.voucherType ? `<VOUCHERTYPENAME>${esc(params.voucherType)}</VOUCHERTYPENAME>` : '';
  const date = params.date ? `<DATE>${params.date.replace(/-/g, '')}</DATE>` : '';
  return `<VOUCHER ACTION="Cancel" VCHTYPE="${esc(params.voucherType || '')}">
${date}
${voucherType}
<MASTERID>${esc(params.masterId)}</MASTERID>
</VOUCHER>`;
}

// --- Main Handler ---

const masterOperations = new Set([
  'create-ledger',
  'delete-ledger',
  'create-group',
  'update-group',
  'delete-group',
  'create-stock-item',
  'delete-stock-item',
  'create-unit',
  'delete-unit',
]);

const voucherOperations = new Set(['create-voucher', 'cancel-voucher']);

const xmlBuilders: Record<string, (params: Record<string, any>) => string> = {
  'create-ledger': buildCreateLedgerXML,
  'delete-ledger': buildDeleteLedgerXML,
  'create-group': buildCreateGroupXML,
  'update-group': buildUpdateGroupXML,
  'delete-group': buildDeleteGroupXML,
  'create-stock-item': buildCreateStockItemXML,
  'delete-stock-item': buildDeleteStockItemXML,
  'create-unit': buildCreateUnitXML,
  'delete-unit': buildDeleteUnitXML,
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

    const reportName = voucherOperations.has(operation)
      ? 'Vouchers'
      : 'All Masters';
    const targetCompany = params.targetCompany || undefined;
    const innerXML = builder(params);
    const fullXML = buildImportEnvelope(targetCompany, reportName, innerXML);
    const response = await postTallyXML(fullXML);
    return parsePushResponse(response);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Push operation failed' };
  }
}
