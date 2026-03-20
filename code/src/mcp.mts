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
      description: `executes sql query on DuckDB in-memory database for querying cached Tally Prime report data in table generated as output by other tools (in tableID property from tool output response). These tables are temporary and will be dropped after 15 minutes automatically. Use this tool to run complex analytical queries to aggregate, filter, sort results. Returns output in tab separated format`,
      inputSchema: {
        sql: z
          .string()
          .describe('SQL query to execute on DuckDB in-memory database'),
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
      description: `fetches list of masters from Tally Prime collection e.g. group, ledger, vouchertype, unit, godown, stockgroup, stockitem, costcategory, costcentre, attendancetype, company, currency, gstin, gstclassification returns output in tab separated format`,
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
      description: `fetches chart of accounts or group structure / GL hierarchywith fields group_name, group_parent, bs_pl, dr_cr, affects_gross_profit. the column bs_pl will have values BS = Balance Sheet / PL = Profit Loss. Column dr_cr as value D = Debit / C = Credit. columns group and parent are tree structure represented in flat format. The column affects_gross_profit has values Y = Yes / N = No, it is used to determine if ledger under this group will affect gross profit or not. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches trial balance with fields ledger_name, group_name, opening_balance, net_debit, net_credit, closing_balance. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches profit and loss statement with fields like ledger_name, group_name, amount. amount negative is debit or expense and positive is credit or income. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches balance sheet with fields like ledger_name, group_name, closing_balance. closing balance negative is debit or asset and positive is credit or liability. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches stock item summary with fields name, parent, opening_quantity, opening_value, inward_quantity, inward_value, outward_quantity, outward_value, closing_quantity, closing_value, returns output cached in DuckDB in-memory table (specified in tableID property). synonyms (name=stock item / parent=stock group) Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches ledger closing balance as on date, negative is debit and positive is credit`,
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
      description: `fetches stock item remaining quantity balance as on date`,
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
      description: `fetches pending overdue outstanding bills receivable or payable as on date with fields bill_date,reference_number,outstanding_amount,party_name,overdue_days. outstanding_amount = Debit is negative and Credit is positive. party_name = ledger_name. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches GL ledger account statement with voucher level details containing fields date, voucher_type, voucher_number, party_name, amount, narration . amount = debit is negative and credit is positive. party_name = ledger_name. returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
      description: `fetches GL stock item account statement with voucher level details containing fields date, voucher_type, voucher_number, party_name, quantity, amount, narration, tracking_number, voucher_category. party_name = ledger_name. quantity = inward as positive and outward as negative. amount = debit is negative and credit is positive, narration = notes / remarks. for calculating closing balance of quantity, consider rows with tracking_number as empty as it is, but for rows with tracking_number having text value, then duplicate rows need to be removed by preparing intermediate output with aggregation of tracking_number and voucher_category with sum of quantity and then comparing quantity of Receipt Note with Purchase and Delivery Note with Sales to identify and remove the rows with Receipt Note and Delivery Note if they are found to be tracked fully / partially . returns output cached in DuckDB in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis`,
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
        'Creates a new ledger account in Tally Prime. Use list-master with collection as group to validate the parent group name before calling this tool.',
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
    'delete-ledger',
    {
      title: 'Delete Ledger',
      description:
        'Deletes a ledger from Tally Prime. The ledger must not have any transactions. Validate ledger name using list-master with collection as ledger.',
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
        'Creates a new group in Tally Prime chart of accounts. Validate parent group using list-master with collection as group.',
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
        'Updates an existing group in Tally Prime. Validate group name using list-master with collection as group.',
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
        'Deletes a group from Tally Prime. The group must be empty (no ledgers or sub-groups). Validate group name using list-master with collection as group.',
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
        'Creates a new stock item in Tally Prime. Validate base unit using list-master with collection as unit.',
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
        'Deletes a stock item from Tally Prime. The stock item must not have any transactions. Validate name using list-master with collection as stockitem.',
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
        'Creates a new unit of measurement in Tally Prime e.g. Nos, Kgs, Ltrs, Pcs',
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
        'Deletes a unit of measurement from Tally Prime. The unit must not be in use by any stock item. Validate name using list-master with collection as unit.',
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
        'Creates an accounting voucher in Tally Prime. Supports all voucher types: Sales, Purchase, Payment, Receipt, Journal, Contra, Credit Note, Debit Note. Each voucher must have at least 2 ledger entries where total debits equal total credits. For debit entries set isDeemedPositive=true and amount as negative. For credit entries set isDeemedPositive=false and amount as positive. Validate ledger names using list-master with collection as ledger and voucher type using list-master with collection as vouchertype.',
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
        'Cancels a voucher in Tally Prime using its master ID. The master ID can be obtained from voucher details or ledger account statements.',
      inputSchema: {
        targetCompany: z.string().optional().describe('optional company name'),
        masterId: z.string().describe('master ID of the voucher to cancel'),
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
