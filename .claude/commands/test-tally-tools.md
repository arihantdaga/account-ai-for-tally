---
description: Run a comprehensive test of all Tally MCP push tools against a test company
arguments:
  - name: company
    description: The Tally test company name to run tests against
    required: true
---

# Test Tally MCP Push Tools

Run all push tools (create, update, delete) against the test company `$ARGUMENTS.company` and report results.

## Instructions

1. Use the TallyPrime MCP tools to run each test below sequentially
2. For each test, record: PASS, FAIL (with error), or SKIPPED (with reason)
3. If a create operation fails, mark its corresponding delete as SKIPPED (dependency failed)
4. At the end, print a summary table of all results

## Test Plan

Run these tests in order against targetCompany=`$ARGUMENTS.company`:

### Phase 1: Master Creation
1. **create-unit**: Create unit "TestPcs" (isSimpleUnit: true)
2. **create-group**: Create group "Test Debtors" under parent "Sundry Debtors"
3. **create-ledger**: Create ledger "Test Customer ABC" under parent "Test Debtors"
4. **create-stock-item**: Create stock item "Test Widget" with baseUnit "TestPcs"

### Phase 2: Verify Masters
5. **list-master (unit)**: Verify "TestPcs" appears in unit list
6. **list-master (group)**: Verify "Test Debtors" appears in group list
7. **list-master (ledger)**: Verify "Test Customer ABC" appears in ledger list
8. **list-master (stockitem)**: Verify "Test Widget" appears in stock item list

### Phase 3: Group Update
9. **update-group**: Update "Test Debtors" to set enableBillWise=true

### Phase 4: Voucher Operations
10. **create-voucher (Journal)**: Create a Journal voucher with:
    - date: today's date in YYYY-MM-DD
    - ledgerEntries: debit "Test Customer ABC" -500, credit "Cash" 500 (cash must exist; if not, use Profit & Loss A/c)
    - narration: "MCP test voucher"
11. **ledger-account**: Fetch "Test Customer ABC" ledger account to get the master_id of the voucher just created
12. **cancel-voucher**: Cancel the voucher using the master_id, voucherType, and date from step 11

### Phase 5: Cleanup (Delete Masters)
13. **delete-stock-item**: Delete "Test Widget"
14. **delete-ledger**: Delete "Test Customer ABC"
15. **delete-group**: Delete "Test Debtors"
16. **delete-unit**: Delete "TestPcs"

### Phase 6: Verify Cleanup
17. **list-master (ledger)**: Verify "Test Customer ABC" no longer appears
18. **list-master (unit)**: Verify "TestPcs" no longer appears

## Output Format

Print a final summary table like:

| # | Test | Tool | Status | Notes |
|---|------|------|--------|-------|
| 1 | Create unit | create-unit | PASS/FAIL/SKIPPED | error or skip reason |
| ... | ... | ... | ... | ... |

Then a one-line summary: X/18 passed, Y failed, Z skipped.
