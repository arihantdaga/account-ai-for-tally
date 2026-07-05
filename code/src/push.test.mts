import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tally module before importing push
vi.mock('./tally.mjs', () => ({
  postTallyXML: vi.fn(),
}));

// Dynamic import after mock is set up
const { handlePush } = await import('./push.mjs');
const tallyModule = await import('./tally.mjs');
const mockedPostTallyXML = vi.mocked(tallyModule.postTallyXML);

const SUCCESS_RESPONSE =
  '<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>0</CANCELLED></RESPONSE>';
const DELETE_RESPONSE =
  '<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>1</DELETED><CANCELLED>0</CANCELLED></RESPONSE>';
const ALTER_RESPONSE =
  '<RESPONSE><CREATED>0</CREATED><ALTERED>1</ALTERED><DELETED>0</DELETED><CANCELLED>0</CANCELLED></RESPONSE>';
const CANCEL_RESPONSE =
  '<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>1</CANCELLED></RESPONSE>';

/** Helper: call handlePush with a default success mock and return the captured XML. */
async function callAndCapture(
  operation: string,
  params: Record<string, any>,
  response: string = SUCCESS_RESPONSE,
): Promise<string> {
  let captured = '';
  mockedPostTallyXML.mockImplementationOnce(async (xml: string) => {
    captured = xml;
    return response;
  });
  await handlePush(operation, params);
  return captured;
}

beforeEach(() => {
  mockedPostTallyXML.mockReset();
  mockedPostTallyXML.mockResolvedValue(SUCCESS_RESPONSE);
});

// ─── XML Builder Output Tests ───────────────────────────────────────────────

describe('buildCreateLedgerXML (via handlePush)', () => {
  it('should produce XML with NAME as a child element and Action="Create"', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Cash', parent: 'Current Assets' });
    expect(xml).toContain('<LEDGER Action="Create">');
    expect(xml).toContain('<NAME>Cash</NAME>');
    expect(xml).toContain('<PARENT>Current Assets</PARENT>');
  });

  it('should omit optional fields when not provided', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'TestLedger' });
    expect(xml).toContain('<NAME>TestLedger</NAME>');
    expect(xml).not.toContain('<PARENT>');
    expect(xml).not.toContain('<ADDRESS>');
    expect(xml).not.toContain('<PARTYGSTIN>');
    expect(xml).not.toContain('<LEDGERMOBILE>');
    expect(xml).not.toContain('<LEDSTATENAME>');
    expect(xml).not.toContain('<COUNTRYOFRESIDENCE>');
  });

  it('should include address, gstin, mobile, state, country when provided', async () => {
    const xml = await callAndCapture('create-ledger', {
      name: 'Vendor',
      parent: 'Sundry Creditors',
      address: '123 Main St',
      gstin: '29ABCDE1234F1Z5',
      mobile: '9876543210',
      state: 'Karnataka',
      country: 'India',
    });
    expect(xml).toContain('<ADDRESS>123 Main St</ADDRESS>');
    expect(xml).toContain('<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>');
    expect(xml).toContain('<LEDGERMOBILE>9876543210</LEDGERMOBILE>');
    expect(xml).toContain('<LEDSTATENAME>Karnataka</LEDSTATENAME>');
    expect(xml).toContain('<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>');
  });

  it('should HTML-escape user strings', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'A & B <Corp>' });
    expect(xml).toContain('<NAME>A &amp; B &lt;Corp&gt;</NAME>');
  });

  it('should include opening balance with default Dr type', async () => {
    const xml = await callAndCapture('create-ledger', {
      name: 'Cash',
      parent: 'Current Assets',
      openingBalance: 1500,
    });
    expect(xml).toContain('<OPENINGBALANCE>1500 Dr</OPENINGBALANCE>');
  });

  it('should include opening balance with explicit Cr type', async () => {
    const xml = await callAndCapture('create-ledger', {
      name: 'Vendor',
      parent: 'Sundry Creditors',
      openingBalance: 999,
      openingBalanceType: 'Cr',
    });
    expect(xml).toContain('<OPENINGBALANCE>999 Cr</OPENINGBALANCE>');
  });

  it('should use the magnitude for a negative opening balance', async () => {
    const xml = await callAndCapture('create-ledger', {
      name: 'Cash',
      openingBalance: -2750.5,
      openingBalanceType: 'Dr',
    });
    expect(xml).toContain('<OPENINGBALANCE>2750.5 Dr</OPENINGBALANCE>');
  });

  it('should omit opening balance when not provided', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Cash', parent: 'Current Assets' });
    expect(xml).not.toContain('<OPENINGBALANCE>');
  });
});

describe('buildUpdateLedgerXML (via handlePush)', () => {
  it('should use Action="Alter" with NAME as attribute', async () => {
    const xml = await callAndCapture(
      'update-ledger',
      { ledgerName: 'Cash', openingBalance: 500 },
      ALTER_RESPONSE,
    );
    expect(xml).toMatch(/<LEDGER\s+NAME="Cash"\s+Action="Alter">/);
    // Alter should NOT re-declare NAME as a child element (avoids accidental rename)
    expect(xml).not.toContain('<NAME>Cash</NAME>');
  });

  it('should set opening balance with Dr/Cr type', async () => {
    const drXml = await callAndCapture(
      'update-ledger',
      { ledgerName: 'Cash', openingBalance: 2750.5, openingBalanceType: 'Dr' },
      ALTER_RESPONSE,
    );
    expect(drXml).toContain('<OPENINGBALANCE>2750.5 Dr</OPENINGBALANCE>');

    const crXml = await callAndCapture(
      'update-ledger',
      { ledgerName: 'Loan', openingBalance: 10000, openingBalanceType: 'Cr' },
      ALTER_RESPONSE,
    );
    expect(crXml).toContain('<OPENINGBALANCE>10000 Cr</OPENINGBALANCE>');
  });

  it('should allow clearing opening balance with 0', async () => {
    const xml = await callAndCapture(
      'update-ledger',
      { ledgerName: 'Cash', openingBalance: 0 },
      ALTER_RESPONSE,
    );
    expect(xml).toContain('<OPENINGBALANCE>0 Dr</OPENINGBALANCE>');
  });

  it('should update other master fields when provided', async () => {
    const xml = await callAndCapture(
      'update-ledger',
      {
        ledgerName: 'Vendor',
        parent: 'Sundry Creditors',
        gstin: '29ABCDE1234F1Z5',
        mobile: '9876543210',
      },
      ALTER_RESPONSE,
    );
    expect(xml).toContain('<PARENT>Sundry Creditors</PARENT>');
    expect(xml).toContain('<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>');
    expect(xml).toContain('<LEDGERMOBILE>9876543210</LEDGERMOBILE>');
  });

  it('should HTML-escape the ledger name attribute', async () => {
    const xml = await callAndCapture(
      'update-ledger',
      { ledgerName: 'A & B', openingBalance: 100 },
      ALTER_RESPONSE,
    );
    expect(xml).toContain('NAME="A &amp; B"');
  });

  it('should return altered=1 on success', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(ALTER_RESPONSE);
    const result = await handlePush('update-ledger', {
      ledgerName: 'Cash',
      openingBalance: 500,
    });
    expect(result.success).toBe(true);
    expect(result.altered).toBe(1);
  });
});

describe('buildDeleteLedgerXML (via handlePush)', () => {
  it('should use ACTION="DELETE" (uppercase) with NAME as both attribute and child', async () => {
    const xml = await callAndCapture('delete-ledger', { ledgerName: 'OldLedger' }, DELETE_RESPONSE);
    expect(xml).toContain('ACTION="DELETE"');
    expect(xml).toContain('NAME="OldLedger"');
    expect(xml).toContain('<NAME>OldLedger</NAME>');
    expect(xml).toMatch(/<LEDGER\s+NAME="OldLedger"\s+ACTION="DELETE">/);
  });
});

describe('buildCreateGroupXML (via handlePush)', () => {
  it('should use Action="Create" with NAME as child element (not attribute)', async () => {
    const xml = await callAndCapture('create-group', { groupName: 'MyGroup', parentGroup: 'Primary' });
    expect(xml).toContain('<GROUP Action="Create">');
    expect(xml).toContain('<NAME>MyGroup</NAME>');
    expect(xml).toContain('<PARENT>Primary</PARENT>');
    // NAME should NOT be an XML attribute for create
    expect(xml).not.toMatch(/<GROUP\s+NAME="/);
  });

  it('should include ISBILLWISEON and ISADDABLE as Yes/No', async () => {
    const xml = await callAndCapture('create-group', {
      groupName: 'BillGroup',
      parentGroup: 'Sundry Debtors',
      enableBillWise: true,
      isAddable: false,
    });
    expect(xml).toContain('<ISBILLWISEON>Yes</ISBILLWISEON>');
    expect(xml).toContain('<ISADDABLE>No</ISADDABLE>');
  });

  it('should omit ISBILLWISEON and ISADDABLE when not provided', async () => {
    const xml = await callAndCapture('create-group', { groupName: 'SimpleGroup', parentGroup: 'Primary' });
    expect(xml).not.toContain('<ISBILLWISEON>');
    expect(xml).not.toContain('<ISADDABLE>');
  });
});

describe('buildUpdateGroupXML (via handlePush)', () => {
  it('should use ACTION="Alter" with NAME as attribute', async () => {
    const xml = await callAndCapture('update-group', { groupName: 'MyGroup', parentGroup: 'Secondary' }, ALTER_RESPONSE);
    expect(xml).toContain('ACTION="Alter"');
    expect(xml).toMatch(/<GROUP\s+NAME="MyGroup"\s+ACTION="Alter">/);
    expect(xml).toContain('<PARENT>Secondary</PARENT>');
  });

  it('should include boolean fields as Yes/No', async () => {
    const xml = await callAndCapture('update-group', {
      groupName: 'MyGroup',
      enableBillWise: false,
      isAddable: true,
    }, ALTER_RESPONSE);
    expect(xml).toContain('<ISBILLWISEON>No</ISBILLWISEON>');
    expect(xml).toContain('<ISADDABLE>Yes</ISADDABLE>');
  });
});

describe('buildDeleteGroupXML (via handlePush)', () => {
  it('should use ACTION="DELETE" (uppercase) with NAME as both attribute and child', async () => {
    const xml = await callAndCapture('delete-group', { groupName: 'OldGroup' }, DELETE_RESPONSE);
    expect(xml).toContain('ACTION="DELETE"');
    expect(xml).toMatch(/<GROUP\s+NAME="OldGroup"\s+ACTION="DELETE">/);
    expect(xml).toContain('<NAME>OldGroup</NAME>');
  });
});

describe('buildCreateStockItemXML (via handlePush)', () => {
  it('should include NAME as child and BASEUNITS', async () => {
    const xml = await callAndCapture('create-stock-item', { name: 'Widget', baseUnit: 'Nos' });
    expect(xml).toContain('<STOCKITEM Action="Create">');
    expect(xml).toContain('<NAME>Widget</NAME>');
    expect(xml).toContain('<BASEUNITS>Nos</BASEUNITS>');
  });

  it('should include opening balance when provided', async () => {
    const xml = await callAndCapture('create-stock-item', { name: 'Widget', baseUnit: 'Nos', openingBalance: 100 });
    expect(xml).toContain('<OPENINGBALANCE>100</OPENINGBALANCE>');
  });

  it('should omit opening balance when not provided', async () => {
    const xml = await callAndCapture('create-stock-item', { name: 'Widget', baseUnit: 'Nos' });
    expect(xml).not.toContain('<OPENINGBALANCE>');
  });

  it('should include GST details when hsnCode and gstRate are provided', async () => {
    const xml = await callAndCapture('create-stock-item', {
      name: 'TaxableItem',
      baseUnit: 'Nos',
      hsnCode: '8471',
      gstRate: 18,
    });
    expect(xml).toContain('<HSNCODE>8471</HSNCODE>');
    expect(xml).toContain('<GSTDETAILS.LIST>');
    // Half rate for Central Tax and State Tax
    expect(xml).toContain('<GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>');
    expect(xml).toContain('<GSTRATE>9</GSTRATE>');
    expect(xml).toContain('<GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>');
    expect(xml).toContain('<GSTRATE>18</GSTRATE>');
  });

  it('should omit GST details when hsnCode or gstRate is missing', async () => {
    const xml = await callAndCapture('create-stock-item', { name: 'PlainItem', baseUnit: 'Nos', hsnCode: '8471' });
    expect(xml).not.toContain('<GSTDETAILS.LIST>');
  });
});

describe('buildDeleteStockItemXML (via handlePush)', () => {
  it('should use ACTION="DELETE" with NAME as both attribute and child', async () => {
    const xml = await callAndCapture('delete-stock-item', { stockItemName: 'OldItem' }, DELETE_RESPONSE);
    expect(xml).toContain('ACTION="DELETE"');
    expect(xml).toMatch(/<STOCKITEM\s+NAME="OldItem"\s+ACTION="DELETE">/);
    expect(xml).toContain('<NAME>OldItem</NAME>');
  });
});

describe('buildCreateUnitXML (via handlePush)', () => {
  it('should use Yes/No for ISSIMPLEUNIT (not true/false)', async () => {
    const xml = await callAndCapture('create-unit', { name: 'Nos', isSimpleUnit: true });
    expect(xml).toContain('<ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>');
    expect(xml).not.toContain('<ISSIMPLEUNIT>true</ISSIMPLEUNIT>');
  });

  it('should output No when isSimpleUnit is false', async () => {
    const xml = await callAndCapture('create-unit', { name: 'Boxes', isSimpleUnit: false });
    expect(xml).toContain('<ISSIMPLEUNIT>No</ISSIMPLEUNIT>');
    expect(xml).not.toContain('<ISSIMPLEUNIT>false</ISSIMPLEUNIT>');
  });

  it('should include NAME as child element', async () => {
    const xml = await callAndCapture('create-unit', { name: 'Kgs', isSimpleUnit: true });
    expect(xml).toContain('<NAME>Kgs</NAME>');
    expect(xml).toContain('<UNIT Action="Create">');
  });
});

describe('buildDeleteUnitXML (via handlePush)', () => {
  it('should use ACTION="DELETE" with NAME as both attribute and child', async () => {
    const xml = await callAndCapture('delete-unit', { unitName: 'OldUnit' }, DELETE_RESPONSE);
    expect(xml).toContain('ACTION="DELETE"');
    expect(xml).toMatch(/<UNIT\s+NAME="OldUnit"\s+ACTION="DELETE">/);
    expect(xml).toContain('<NAME>OldUnit</NAME>');
  });
});

describe('buildCreateVoucherXML (via handlePush)', () => {
  const validVoucherParams = {
    voucherType: 'Sales',
    date: '2024-03-15',
    ledgerEntries: [
      { ledgerName: 'Cash', amount: -1000, isDeemedPositive: true },
      { ledgerName: 'Sales Account', amount: 1000, isDeemedPositive: false },
    ],
  };

  it('should convert date from YYYY-MM-DD to YYYYMMDD', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('<DATE>20240315</DATE>');
    expect(xml).not.toContain('2024-03-15');
  });

  it('should include ALLLEDGERENTRIES.LIST for each entry', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('<ALLLEDGERENTRIES.LIST>');
    expect(xml).toContain('<LEDGERNAME>Cash</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Sales Account</LEDGERNAME>');
    expect(xml).toContain('<AMOUNT>-1000</AMOUNT>');
    expect(xml).toContain('<AMOUNT>1000</AMOUNT>');
  });

  it('should include PERSISTEDVIEW', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>');
  });

  it('should include ISDEEMEDPOSITIVE as Yes/No', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
    expect(xml).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>');
  });

  it('should include narration and partyLedger when provided', async () => {
    const xml = await callAndCapture('create-voucher', {
      ...validVoucherParams,
      narration: 'Test narration',
      partyLedger: 'Customer A',
    });
    expect(xml).toContain('<NARRATION>Test narration</NARRATION>');
    expect(xml).toContain('<PARTYLEDGERNAME>Customer A</PARTYLEDGERNAME>');
  });

  it('should omit narration and partyLedger when not provided', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).not.toContain('<NARRATION>');
    expect(xml).not.toContain('<PARTYLEDGERNAME>');
  });

  it('should use VCHTYPE attribute and VOUCHERTYPENAME element', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
  });

  it('should use "Vouchers" report name for voucher operations', async () => {
    const xml = await callAndCapture('create-voucher', validVoucherParams);
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
  });
});

describe('buildCancelVoucherXML (via handlePush)', () => {
  it('should use ACTION="Cancel" and VCHTYPE attribute', async () => {
    const xml = await callAndCapture('cancel-voucher', {
      voucherType: 'Sales',
      masterId: '12345',
      date: '2024-03-15',
    }, CANCEL_RESPONSE);
    expect(xml).toContain('ACTION="Cancel"');
    expect(xml).toContain('VCHTYPE="Sales"');
    // Vouchers are identified by MasterID (globally unique) via TAGNAME/TAGVALUE,
    // not VoucherNumber, which is ambiguous across voucher types.
    expect(xml).toContain('TAGNAME="MasterID"');
    expect(xml).toContain('TAGVALUE="12345"');
  });

  it('should format the cancel date as DD-MMM-YYYY in the DATE attribute', async () => {
    const xml = await callAndCapture('cancel-voucher', {
      voucherType: 'Sales',
      masterId: '12345',
      date: '2024-03-15',
    }, CANCEL_RESPONSE);
    expect(xml).toContain('DATE="15-Mar-2024"');
  });

  it('should carry the voucher type in the VCHTYPE attribute', async () => {
    const xml = await callAndCapture('cancel-voucher', {
      voucherType: 'Purchase',
      masterId: '67890',
      date: '2024-06-01',
    }, CANCEL_RESPONSE);
    expect(xml).toContain('VCHTYPE="Purchase"');
  });
});

// ─── Import Envelope Tests ──────────────────────────────────────────────────

describe('buildImportEnvelope (via handlePush)', () => {
  it('should include SVCURRENTCOMPANY when targetCompany is provided', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Test', targetCompany: 'MyCompany' });
    expect(xml).toContain('<STATICVARIABLES>');
    expect(xml).toContain('<SVCURRENTCOMPANY>MyCompany</SVCURRENTCOMPANY>');
  });

  it('should omit STATICVARIABLES when targetCompany is not provided', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Test' });
    expect(xml).not.toContain('<STATICVARIABLES>');
    expect(xml).not.toContain('<SVCURRENTCOMPANY>');
  });

  it('should use "All Masters" report name for master operations', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Test' });
    expect(xml).toContain('<REPORTNAME>All Masters</REPORTNAME>');
  });

  it('should use "Vouchers" report name for voucher operations', async () => {
    const xml = await callAndCapture('create-voucher', {
      voucherType: 'Sales',
      date: '2024-01-01',
      ledgerEntries: [
        { ledgerName: 'A', amount: -100, isDeemedPositive: true },
        { ledgerName: 'B', amount: 100, isDeemedPositive: false },
      ],
    });
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
  });

  it('should HTML-escape company name', async () => {
    const xml = await callAndCapture('create-ledger', { name: 'Test', targetCompany: 'A & B Corp' });
    expect(xml).toContain('<SVCURRENTCOMPANY>A &amp; B Corp</SVCURRENTCOMPANY>');
  });
});

// ─── Response Parser Tests (via handlePush return value) ────────────────────

describe('parsePushResponse (via handlePush)', () => {
  it('should parse a success response with CREATED=1', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(SUCCESS_RESPONSE);
    const result = await handlePush('create-ledger', { name: 'Test' });
    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(result.altered).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.cancelled).toBe(0);
  });

  it('should parse a delete success response with DELETED=1', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(DELETE_RESPONSE);
    const result = await handlePush('delete-ledger', { ledgerName: 'Old' });
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(1);
  });

  it('should parse an altered response', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(ALTER_RESPONSE);
    const result = await handlePush('update-group', { groupName: 'G', parentGroup: 'P' });
    expect(result.success).toBe(true);
    expect(result.altered).toBe(1);
  });

  it('should parse a cancelled response', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(CANCEL_RESPONSE);
    const result = await handlePush('cancel-voucher', {
      voucherType: 'Sales',
      masterId: '123',
      date: '2024-01-01',
    });
    expect(result.success).toBe(true);
    expect(result.cancelled).toBe(1);
  });

  it('should parse error response with LINEERROR', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(
      '<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>0</CANCELLED><LINEERROR>Ledger already exists</LINEERROR></RESPONSE>',
    );
    const result = await handlePush('create-ledger', { name: 'Dup' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Ledger already exists');
  });

  it('should return error for empty response', async () => {
    mockedPostTallyXML.mockResolvedValueOnce('');
    const result = await handlePush('create-ledger', { name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should return error for whitespace-only response', async () => {
    mockedPostTallyXML.mockResolvedValueOnce('   ');
    const result = await handlePush('create-ledger', { name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('should handle malformed XML gracefully', async () => {
    mockedPostTallyXML.mockResolvedValueOnce('<RESPONSE><UNCLOSED>');
    const result = await handlePush('create-ledger', { name: 'Test' });
    // Should not throw, should return some result
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  it('should return error when no records affected and no line error', async () => {
    mockedPostTallyXML.mockResolvedValueOnce(
      '<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><CANCELLED>0</CANCELLED></RESPONSE>',
    );
    const result = await handlePush('create-ledger', { name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('no records affected');
  });

  it('should handle postTallyXML throwing an error', async () => {
    mockedPostTallyXML.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await handlePush('create-ledger', { name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});

// ─── Validation Tests ───────────────────────────────────────────────────────

describe('handlePush validation', () => {
  it('should return error for unknown operation', async () => {
    const result = await handlePush('unknown-op', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown operation');
    // postTallyXML should never be called
    expect(mockedPostTallyXML).not.toHaveBeenCalled();
  });

  it('should return error for create-voucher with less than 2 ledger entries', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      date: '2024-01-01',
      ledgerEntries: [{ ledgerName: 'A', amount: 100, isDeemedPositive: true }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('at least 2 ledger entries');
    expect(mockedPostTallyXML).not.toHaveBeenCalled();
  });

  it('should return error for create-voucher with empty ledger entries', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      date: '2024-01-01',
      ledgerEntries: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('at least 2 ledger entries');
  });

  it('should return error for create-voucher with no ledgerEntries field', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      date: '2024-01-01',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('at least 2 ledger entries');
  });

  it('should return error for create-voucher with invalid date format', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      date: '15-03-2024',
      ledgerEntries: [
        { ledgerName: 'A', amount: -100, isDeemedPositive: true },
        { ledgerName: 'B', amount: 100, isDeemedPositive: false },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('YYYY-MM-DD');
    expect(mockedPostTallyXML).not.toHaveBeenCalled();
  });

  it('should return error for create-voucher with missing date', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      ledgerEntries: [
        { ledgerName: 'A', amount: -100, isDeemedPositive: true },
        { ledgerName: 'B', amount: 100, isDeemedPositive: false },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('YYYY-MM-DD');
  });

  it('should return error for create-voucher with date in wrong format (no dashes)', async () => {
    const result = await handlePush('create-voucher', {
      voucherType: 'Sales',
      date: '20240315',
      ledgerEntries: [
        { ledgerName: 'A', amount: -100, isDeemedPositive: true },
        { ledgerName: 'B', amount: 100, isDeemedPositive: false },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('YYYY-MM-DD');
  });
});
