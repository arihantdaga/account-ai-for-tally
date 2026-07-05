import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cacheTable, executeSQL } from './database.mjs';
import { handlePush } from './push.mjs';
import { handlePull, jsonToTSV } from './tally.mjs';

export async function registerMcpServer(): Promise<McpServer> {
  const mcpServer = new McpServer({
    name: 'Tally Prime MCP Server',
    title: 'Tally Prime',
    version: '1.0.0',
  });

  mcpServer.registerTool(
    'query-database',
    {
      title: 'Query Database',
      description: `Run SQL queries on cached Tally data. Other tools (trial-balance, ledger-account, etc.) cache their results in temporary in-memory SQL tables and return a tableID. Use this tool to query those tables with standard SQL (SQLite dialect) for aggregation, filtering, sorting, and joins. Dates are stored as 'YYYY-MM-DD' text — use SQLite date functions (date(), strftime()) rather than DuckDB-style date_trunc. Tables auto-expire after 15 minutes. Returns tab-separated output.`,
      inputSchema: {
        sql: z
          .string()
          .describe('SQL query to execute on the in-memory SQLite database (SQLite dialect)'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await executeSQL(args.sql);
      return {
        content: [{ type: 'text', text: resp }],
      };
    },
  );

  mcpServer.registerTool(
    'list-master',
    {
      title: 'List Masters',
      description: `List all master records of a given type from Tally. Use this to look up valid names before creating vouchers or other masters. Collections: group (account groups), ledger (GL accounts/parties), vouchertype, unit (UOM), godown (warehouse), stockgroup, stockitem (inventory), costcategory, costcentre, attendancetype, company, currency, gstin, gstclassification. Returns tab-separated list of names.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        collection: z.string(
          z.enum([
            'group',
            'ledger',
            'vouchertype',
            'unit',
            'godown',
            'stockgroup',
            'stockitem',
            'costcategory',
            'costcentre',
            'attendancetype',
            'company',
            'currency',
            'gstin',
            'gstclassification',
          ]),
        ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([['collection', args.collection]]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('list-master', inputParams);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [{ type: 'text', text: jsonToTSV(resp.data) }],
        };
      }
    },
  );

  mcpServer.registerTool(
    'chart-of-accounts',
    {
      title: 'Chart of Accounts',
      description: `Fetch the full chart of accounts (group hierarchy) from Tally. Returns fields: group_name, group_parent, bs_pl (BS=Balance Sheet, PL=Profit & Loss), dr_cr (D=Debit, C=Credit), affects_gross_profit (Y/N). The group/parent columns form a tree in flat format. Fetch this before using trial-balance, profit-loss, or balance-sheet to understand the GL structure. Result is cached in an in-memory SQL table — use query-database with the returned tableID for analysis.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map();
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('chart-of-accounts', inputParams);
      const tableId = await cacheTable('chart-of-accounts', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'trial-balance',
    {
      title: 'Trial Balance',
      description: `Fetch trial balance for a date range. Returns fields: ledger_name, group_name, opening_balance, net_debit, net_credit, closing_balance. Tip: fetch chart-of-accounts first to understand group hierarchy. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        fromDate: z.string().describe('date in YYYY-MM-DD format'),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['fromDate', args.fromDate],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('trial-balance', inputParams);
      const tableId = await cacheTable('trial-balance', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'profit-loss',
    {
      title: 'Profit and Loss',
      description: `Fetch Profit & Loss statement for a date range. Returns fields: ledger_name, group_name, amount. Negative amount = expense (debit), positive = income (credit). Tip: fetch chart-of-accounts first for group hierarchy. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        fromDate: z.string().describe('date in YYYY-MM-DD format'),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['fromDate', args.fromDate],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('profit-loss', inputParams);
      const tableId = await cacheTable('profit-loss', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'balance-sheet',
    {
      title: 'Balance Sheet',
      description: `Fetch Balance Sheet as on a date. Returns fields: ledger_name, group_name, closing_balance. Negative closing_balance = asset (debit), positive = liability (credit). Tip: fetch chart-of-accounts first for group hierarchy. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([['toDate', args.toDate]]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('balance-sheet', inputParams);
      const tableId = await cacheTable('balance-sheet', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'stock-summary',
    {
      title: 'Stock Summary',
      description: `Fetch inventory stock summary for a date range. Returns fields: name (stock item), parent (stock group), opening_quantity, opening_value, inward_quantity, inward_value, outward_quantity, outward_value, closing_quantity, closing_value. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        fromDate: z.string().describe('date in YYYY-MM-DD format'),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['fromDate', args.fromDate],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('stock-summary', inputParams);
      const tableId = await cacheTable('stock-summary', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'ledger-balance',
    {
      title: 'Ledger Balance',
      description: `Fetch a single ledger's closing balance as on a date. Returns a number: negative = debit balance, positive = credit balance. Use list-master with collection=ledger to validate the ledger name first.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        ledgerName: z
          .string()
          .describe(
            'exact ledger name, validate it using list-master tool with collection as ledger',
          ),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['ledgerName', args.ledgerName],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('ledger-balance', inputParams);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [{ type: 'text', text: JSON.stringify(resp.data) }],
        };
      }
    },
  );

  mcpServer.registerTool(
    'stock-item-balance',
    {
      title: 'Stock Item Balance',
      description: `Fetch a single stock item's remaining quantity balance as on a date. Returns a number. Use list-master with collection=stockitem to validate the item name first.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        itemName: z
          .string()
          .describe(
            'exact stock item name, validate it using list-master tool with collection as stockitem',
          ),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['itemName', args.itemName],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('stock-item-balance', inputParams);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [{ type: 'text', text: JSON.stringify(resp.data) }],
        };
      }
    },
  );

  mcpServer.registerTool(
    'bills-outstanding',
    {
      title: 'Bills Outstanding',
      description: `Fetch outstanding bills (receivable or payable) as on a date. Returns fields: bill_date, reference_number, outstanding_amount (negative=debit, positive=credit), party_name (ledger name), overdue_days. Use nature=receivable for money owed TO you, nature=payable for money you OWE. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        nature: z.enum(['receivable', 'payable']),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['nature', args.nature],
        ['toDate', args.toDate],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }
      const resp = await handlePull('bills-outstanding', inputParams);
      const tableId = await cacheTable('bills-outstanding', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'ledger-account',
    {
      title: 'Ledger Account',
      description: `Fetch detailed ledger account statement (voucher-level transactions) for a date range. Returns fields: date, voucher_type, voucher_number, party_ledger, amount (negative=debit, positive=credit), narration, master_id. The master_id uniquely identifies each voucher and can be used with cancel-voucher. Use list-master with collection=ledger to validate the ledger name. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        ledgerName: z
          .string()
          .describe(
            'exact ledger name, validate it using list-master tool with collection as ledger',
          ),
        fromDate: z.string().describe('date in YYYY-MM-DD format'),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['fromDate', args.fromDate],
        ['toDate', args.toDate],
        ['ledgerName', args.ledgerName],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }

      const resp = await handlePull('ledger-account', inputParams);
      const tableId = await cacheTable('ledger-account', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        //swap opening balance row to the top since it came at the end from Tally XML response
        if (Array.isArray(resp.data) && resp.data.length > 0) {
          const lastItem = resp.data.pop();
          resp.data.unshift(lastItem);
        }
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  mcpServer.registerTool(
    'stock-item-account',
    {
      title: 'Stock Item Account',
      description: `Fetch detailed stock item account statement (voucher-level inventory movements) for a date range. Returns fields: date, voucher_type, voucher_number, party_ledger, quantity (positive=inward, negative=outward), amount (negative=debit, positive=credit), narration, tracking_number, voucher_category, master_id. The master_id uniquely identifies each voucher and can be used with cancel-voucher. Note: rows with tracking_number values may have duplicates from Receipt Note/Delivery Note tracking — aggregate by tracking_number and voucher_category to deduplicate. Use list-master with collection=stockitem to validate the item name. Result cached in an in-memory SQL table — use query-database with the returned tableID.`,
      inputSchema: {
        targetCompany: z
          .string()
          .optional()
          .describe(
            'optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified',
          ),
        itemName: z
          .string()
          .describe(
            'exact stock item name, validate it using list-master tool with collection as stockitem',
          ),
        fromDate: z.string().describe('date in YYYY-MM-DD format'),
        toDate: z.string().describe('date in YYYY-MM-DD format'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const inputParams = new Map([
        ['fromDate', args.fromDate],
        ['toDate', args.toDate],
        ['itemName', args.itemName],
      ]);
      if (args.targetCompany) {
        inputParams.set('targetCompany', args.targetCompany);
      }

      const resp = await handlePull('stock-item-account', inputParams);
      const tableId = await cacheTable('stock-item-account', resp.data);
      if (resp.error) {
        return {
          isError: true,
          content: [{ type: 'text', text: resp.error }],
        };
      } else {
        //swap opening balance row to the top since it came at the end from Tally XML response
        if (Array.isArray(resp.data) && resp.data.length > 0) {
          const lastItem = resp.data.pop();
          resp.data.unshift(lastItem);
        }
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tableID: tableId }) },
          ],
        };
      }
    },
  );

  // --- Push Operations: Masters ---

  mcpServer.registerTool(
    'create-ledger',
    {
      title: 'Create Ledger',
      description:
        'Create a new ledger (GL account, party, expense head, etc.) in Tally. The parent group determines the ledger type — e.g. Sundry Debtors for customers, Sundry Creditors for vendors, Direct Expenses for costs, Sales Accounts for revenue. Always validate parent group name using list-master with collection=group first.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        name: z.string().describe('ledger name'),
        parent: z
          .string()
          .describe(
            'parent group name e.g. Sundry Debtors, Sundry Creditors, Bank Accounts, Cash-in-Hand, Direct Expenses, Indirect Expenses, Purchase Accounts, Sales Accounts',
          ),
        address: z.string().optional().describe('address of the party'),
        country: z.string().optional().describe('country name'),
        state: z.string().optional().describe('state name for GST'),
        mobile: z.string().optional().describe('mobile number'),
        gstin: z.string().optional().describe('GSTIN number'),
        openingBalance: z
          .number()
          .optional()
          .describe(
            'opening balance amount as a positive number (magnitude). Combine with openingBalanceType for Dr/Cr. Omit for no opening balance.',
          ),
        openingBalanceType: z
          .enum(['Dr', 'Cr'])
          .optional()
          .describe(
            "'Dr' (debit) or 'Cr' (credit). Defaults to Dr. Use Dr for assets/debtors/expenses, Cr for liabilities/creditors/income/capital.",
          ),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('create-ledger', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to create ledger' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'update-ledger',
    {
      title: 'Update Ledger',
      description:
        "Alter an existing ledger in Tally. Its main use is setting or correcting a ledger's opening balance (the balance carried forward as of the start of the books), but it can also update the parent group, address, state, mobile, or GSTIN. Only the fields you pass are changed; everything else is left intact. Validate the exact ledger name with list-master (collection=ledger) first. Note: opening balance is meaningful for balance-sheet ledgers (assets/liabilities); for revenue ledgers Tally may ignore it.",
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        ledgerName: z.string().describe('exact name of the ledger to update'),
        openingBalance: z
          .number()
          .optional()
          .describe(
            'new opening balance as a positive number (magnitude). Combine with openingBalanceType for Dr/Cr. Pass 0 to clear the opening balance.',
          ),
        openingBalanceType: z
          .enum(['Dr', 'Cr'])
          .optional()
          .describe(
            "'Dr' (debit) or 'Cr' (credit) for the opening balance. Defaults to Dr. Use Dr for assets/debtors/expenses, Cr for liabilities/creditors/income/capital.",
          ),
        parent: z.string().optional().describe('new parent group name'),
        address: z.string().optional().describe('address of the party'),
        country: z.string().optional().describe('country name'),
        state: z.string().optional().describe('state name for GST'),
        mobile: z.string().optional().describe('mobile number'),
        gstin: z.string().optional().describe('GSTIN number'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('update-ledger', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to update ledger' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'delete-ledger',
    {
      title: 'Delete Ledger',
      description:
        'Delete a ledger from Tally. Only works if the ledger has no transactions. Validate exact name using list-master with collection=ledger first.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        ledgerName: z.string().describe('exact ledger name to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await handlePush('delete-ledger', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to delete ledger' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'create-group',
    {
      title: 'Create Group',
      description:
        'Create a new account group in Tally chart of accounts. Groups organize ledgers hierarchically (e.g. a "North Region Debtors" sub-group under Sundry Debtors). Validate parent group using list-master with collection=group.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        groupName: z.string().describe('name for the new group'),
        parentGroup: z.string().describe('parent group name'),
        enableBillWise: z
          .boolean()
          .optional()
          .describe('enable bill-wise accounting for ledgers under this group'),
        isAddable: z
          .boolean()
          .optional()
          .describe('whether ledgers can be created directly under this group'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('create-group', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to create group' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'update-group',
    {
      title: 'Update Group',
      description:
        'Update properties of an existing account group (e.g. change parent, enable bill-wise tracking). Validate group name using list-master with collection=group.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        groupName: z.string().describe('name of the group to update'),
        parentGroup: z.string().optional().describe('new parent group name'),
        enableBillWise: z
          .boolean()
          .optional()
          .describe('enable or disable bill-wise accounting'),
        isAddable: z
          .boolean()
          .optional()
          .describe('whether ledgers can be created directly under this group'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('update-group', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to update group' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'delete-group',
    {
      title: 'Delete Group',
      description:
        'Delete an account group from Tally. The group must have no ledgers or sub-groups under it. Validate name using list-master with collection=group.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        groupName: z.string().describe('exact group name to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await handlePush('delete-group', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to delete group' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'create-stock-item',
    {
      title: 'Create Stock Item',
      description:
        'Create a new inventory stock item in Tally. Requires a base unit of measurement (e.g. Nos, Kgs). Optionally set HSN code and GST rate for tax compliance. Validate base unit exists using list-master with collection=unit — create one first if needed.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        name: z.string().describe('stock item name'),
        baseUnit: z
          .string()
          .describe('base unit of measurement e.g. Nos, Kgs, Ltrs'),
        openingBalance: z
          .number()
          .optional()
          .describe('opening balance quantity'),
        hsnCode: z.string().optional().describe('HSN/SAC code for GST'),
        gstRate: z
          .number()
          .optional()
          .describe('GST rate percentage e.g. 5, 12, 18, 28'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('create-stock-item', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to create stock item' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'delete-stock-item',
    {
      title: 'Delete Stock Item',
      description:
        'Delete a stock item from Tally. Only works if the item has no transactions. Delete stock items before deleting their unit of measurement. Validate name using list-master with collection=stockitem.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        stockItemName: z.string().describe('exact stock item name to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await handlePush('delete-stock-item', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to delete stock item' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'create-unit',
    {
      title: 'Create Unit',
      description:
        'Create a unit of measurement in Tally (e.g. Nos, Kgs, Ltrs, Pcs, Boxes). Units are required before creating stock items. Use isSimpleUnit=true for basic units.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        name: z.string().describe('unit name e.g. Nos, Kgs, Ltrs, Pcs'),
        isSimpleUnit: z
          .boolean()
          .describe('true for simple unit, false for compound unit'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('create-unit', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to create unit' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'delete-unit',
    {
      title: 'Delete Unit',
      description:
        'Delete a unit of measurement from Tally. The unit must not be in use by any stock item — delete dependent stock items first. Validate name using list-master with collection=unit.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        unitName: z.string().describe('exact unit name to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await handlePush('delete-unit', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to delete unit' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  // --- Push Operations: Vouchers ---

  mcpServer.registerTool(
    'create-voucher',
    {
      title: 'Create Voucher',
      description:
        'Create an accounting voucher (transaction) in Tally. Supported types: Sales, Purchase, Payment, Receipt, Journal, Contra, Credit Note, Debit Note. Each voucher needs at least 2 ledger entries that balance (debits = credits). Convention: debit entries have isDeemedPositive=true with negative amount; credit entries have isDeemedPositive=false with positive amount. Example: to record a purchase expense of 500 paid by cash, debit the expense ledger (-500, isDeemedPositive=true) and credit Cash (500, isDeemedPositive=false). Always validate ledger names using list-master with collection=ledger first.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        voucherType: z
          .string()
          .describe(
            'voucher type e.g. Sales, Purchase, Payment, Receipt, Journal, Contra, Credit Note, Debit Note',
          ),
        date: z.string().describe('voucher date in YYYY-MM-DD format'),
        partyLedger: z
          .string()
          .optional()
          .describe('party ledger name for Sales/Purchase vouchers'),
        ledgerEntries: z
          .array(
            z.object({
              ledgerName: z.string().describe('ledger name for this entry'),
              amount: z
                .number()
                .describe('amount - negative for debit, positive for credit'),
              isDeemedPositive: z
                .boolean()
                .describe('true for debit entry, false for credit entry'),
            }),
          )
          .describe(
            'array of ledger entries. Total debits must equal total credits.',
          ),
        narration: z
          .string()
          .optional()
          .describe('narration or notes for the voucher'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      const resp = await handlePush('create-voucher', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to create voucher' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  mcpServer.registerTool(
    'cancel-voucher',
    {
      title: 'Cancel Voucher',
      description:
        'Cancels a voucher in Tally Prime by marking it as cancelled — the voucher is preserved in Tally (audit trail) but excluded from all reports and ledger statements. Uses MasterID for unambiguous identification (voucher numbers are NOT unique across voucher types; a Sales and a Journal voucher can both be numbered "1"). Get the master_id, voucher type, and date from the ledger-account or stock-item-account tool output — DO NOT guess these or reuse stale cached values. On success, returns { success: true, cancelled: 1 }.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        masterId: z.string().describe('master ID of the voucher to cancel (globally unique). MUST come from the master_id field in ledger-account or stock-item-account output for this same voucher.'),
        voucherType: z.string().describe('voucher type, must match the voucher_type field from ledger-account output exactly e.g. Sales, Purchase, Payment, Receipt, Journal'),
        date: z.string().describe('voucher date in YYYY-MM-DD format, must match the date field from ledger-account output for this voucher'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const resp = await handlePush('cancel-voucher', args);
      if (!resp.success) {
        return {
          isError: true,
          content: [
            { type: 'text', text: resp.error || 'Failed to cancel voucher' },
          ],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    },
  );

  return mcpServer;
}
