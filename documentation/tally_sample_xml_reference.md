# Tally Sample XML — Reference

> **Source:** <https://help.tallysolutions.com/sample-xml/>
> **Fetched:** 2026-05-18
> **Purpose:** Offline copy of Tally's official sample XML reference, preserved here so the request/response shapes our MCP relies on stay accessible even if the upstream URL changes.

> ⚠️ **Implementation note** (added by this repo, not from the official docs)
>
> The *Voucher Alteration* and *Voucher Cancellation* examples below use `TAGNAME="VoucherNumber" TAGVALUE="<number>"` for voucher lookup. We tested this against a real company and **it is unsafe**: voucher numbers are NOT globally unique (a Sales #2 and a Journal #2 can both exist), and the `VCHTYPE` attribute is **NOT honoured as a filter** in the lookup. Tally will silently apply the action to the wrong voucher.
>
> In this repo we identify vouchers by `TAGNAME="MasterID" TAGVALUE="<master_id>"` for `cancel-voucher`. See `code/src/push.mts` (`buildCancelVoucherXML`) and the matching memory entry `tally-cancel-voucher.md`.
>
> Also: a successful in-place cancel returns `<ALTERED>1</ALTERED>`, NOT `<CANCELLED>1</CANCELLED>` — Tally's `<CANCELLED>` counter is reserved for "create-cancelled-voucher" flows.

---

## Accounting Masters

### Group

A **Group** is a collection of ledgers of the same nature. Account groups are maintained to determine the hierarchy of Ledger Accounts.

XML request to create a group "North Zone Debtors" under the predefined group Sundry Debtors:

```xml
<ENVELOPE>
<HEADER>
       <TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
          <REQUESTDESC>
              <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
              <TALLYMESSAGE xmlns:UDF="TallyUDF">
                     <GROUP Action="Create">
                        <NAME>North Zone Debtors</NAME>
                        <PARENT>Sundry Debtors</PARENT>
                     </GROUP>
             </TALLYMESSAGE>
          </REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>
```

### Ledger

**Ledgers** are commonly known as general ledgers in accounting standards. A ledger in Tally must be created under a group.

| Tag | Data type | Is mandatory | Description |
|-----|-----------|--------------|-------------|
| LEDGER | | Yes | Opening tag |
| NAME | String | Yes | Name of the Ledger |
| PARENT | String | Yes | Should contain a group name from list available in Tally |

XML request to create a ledger:

```xml
<ENVELOPE>
<HEADER>
       <TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
          <REQUESTDESC>
              <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
              <TALLYMESSAGE xmlns:UDF="TallyUDF">
                     <LEDGER Action="Create">
                        <NAME>Customer ABC</NAME>
                        <PARENT>Sundry Debtors</PARENT>
                     </LEDGER>
              </TALLYMESSAGE>
          </REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>
```

### Adding Address Information in Ledger Master

XML tags to include address information in ledger master:

```xml
<LEDGER Action="Create">
   <NAME>Customer ABC</NAME>
   <PARENT>Sundry Debtors</PARENT>
   <MAILINGNAME.LIST TYPE="String">
       <MAILINGNAME>Customer – Mailing name</MAILINGNAME>
   </MAILINGNAME.LIST>
   <ADDRESS.LIST TYPE="String">
       <ADDRESS>Door No </ADDRESS>
       <ADDRESS>Lane</ADDRESS>
       <ADDRESS>Locality</ADDRESS>
   </ADDRESS.LIST>
   <PINCODE>560068</PINCODE>
   <COUNTRYNAME>India</COUNTRYNAME>
   <LEDSTATENAME>Karnataka</LEDSTATENAME>
   <EMAIL>A@abc.com</EMAIL>
   <EMAILCC>ACC@abc.com</EMAILCC>
   <LEDGERPHONE>0888888</LEDGERPHONE>
   <LEDGERMOBILE>99999999</LEDGERMOBILE>
</LEDGER>
```

### Altering a Ledger

To alter an existing ledger in Tally, change the tag as follows:

```xml
<Ledger NAME="Customer ABC" Action="Alter">
```

### Ledger Opening Balance

> ✅ **Implementation note** (added by this repo — verified against a live Tally, not from the official sample-xml page)
>
> The official sample-xml page lists `<OPENINGBALANCE>` only for **stock items**, but a **ledger** opening balance is also settable via the same XML API. We tested it end-to-end against a real company (both on `Action="Create"` and `Action="Alter"`).
>
> Format: `<OPENINGBALANCE>{amount} Dr</OPENINGBALANCE>` or `... Cr</OPENINGBALANCE>` (e.g. `1500.00 Dr`). An optional `DATE="YYYYMMDD"` attribute is accepted (defaults to the beginning-of-books date). Sending only `<OPENINGBALANCE>` on an Alter returns `<ALTERED>1</ALTERED>` and leaves every other field untouched.
>
> **Sign convention on read-back:** when you export a ledger's `OpeningBalance`, Tally returns **Debit as negative** and **Credit as positive** (e.g. `1500 Dr` → `-1500.00`, `999 Cr` → `999.00`). This matches the Dr/Cr handling already used in `code/pull/*.xml`.
>
> Create with opening balance:
> ```xml
> <LEDGER Action="Create">
>   <NAME>Customer ABC</NAME>
>   <PARENT>Sundry Debtors</PARENT>
>   <OPENINGBALANCE>1500.00 Dr</OPENINGBALANCE>
> </LEDGER>
> ```
>
> Alter only the opening balance of an existing ledger:
> ```xml
> <LEDGER NAME="Customer ABC" Action="Alter">
>   <OPENINGBALANCE>2750.50 Dr</OPENINGBALANCE>
> </LEDGER>
> ```
>
> See `code/src/push.mts` (`buildOpeningBalanceXML`, `buildUpdateLedgerXML`) and the `create-ledger` / `update-ledger` MCP tools.

### Guidelines

- Use Tally Connector available in TallyPrime Developer for sending XML requests and receiving responses
- Ensure dependent masters are available in Tally before sending XML request
- Create one nature of master at once for better control
- Tax related information must be sent to Tally to maintain statutory records

---

## Inventory Masters

Inventory masters are needed to maintain stock details of an organization.

| Master | Information |
|--------|-------------|
| Stock Group | Holds collection of stock items |
| Stock Items | Actual inventory master used in transactions |
| Unit of Measure | Stock items are transacted based on quantity measured by UOM |
| Locations/Godowns | Maintain availability of stock at various locations |

### Stock Group

**Stock Group** is similar to Groups in Accounting masters. Stock Groups classify Stock Items based on common features such as brand name, product type, quality, etc.

XML request to create a stock group 'Electronics':

```xml
<ENVELOPE>
<HEADER>
       <TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
          <REQUESTDESC>
              <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
              <TALLYMESSAGE xmlns:UDF="TallyUDF">
                     <STOCKGROUP Action="Create">
                        <NAME>Electronics</NAME>
                     </STOCKGROUP>
         </TALLYMESSAGE>
          </REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>
```

### Stock Item

**Stock Item** refers to goods that an organization manufactures, trades or maintains. The inventory master UOM (Unit of Measure) is mandatory to define the quantity.

| Tag | Data type | Is mandatory | Description |
|-----|-----------|--------------|-------------|
| NAME | String | Yes | Name of the stock item |
| BASEUNITS | String | No | Name of the UOM |

#### Creating a Stock Item

XML request to create a stock item:

```xml
<ENVELOPE>
         <HEADER>
              <TALLYREQUEST>Import data</TALLYREQUEST>
              <TYPE>Data</TYPE>
              <ID>All Masters</ID>
          </HEADER>
       <BODY>
              <IMPORTDATA>
                     <REQUESTDESC>
                            <REPORTNAME>All Masters</REPORTNAME>
                     </REQUESTDESC>
                     <REQUESTDATA>
                            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                                   <STOCKITEM Action="Create">
                                        <NAME>Red Colored Striped Shirt</NAME>
                                         <BASEUNITS>lts</BASEUNITS>
                                          <NAME.LIST TYPE="String">
                                              <NAME>Red Colored Striped Shirt</NAME>
                                          </NAME.LIST>
                                   </STOCKITEM>
                            </TALLYMESSAGE>
                     </REQUESTDATA>
              </IMPORTDATA>
       </BODY>
</ENVELOPE>
```

To create multiple stock items, the tag set `<Stockitem>` can be repeated as required.

#### Altering a Stock Item

Tag and value for stock item alteration:

```xml
<STOCKITEM NAME="Red Colored Striped Shirt" Action="Alter">
```

**Note:** UOM of a stock item cannot be altered when the stock item is used in a transaction or in a master.

### XML Response for Import Data Request

| Tag | Description |
|-----|-------------|
| `<RESPONSE>` | Opening tag of response XML |
| `<CREATED>0</CREATED>` | Number of masters/transactions created |
| `<ALTERED>0</ALTERED>` | Number of masters/transactions altered |
| `<DELETED>0</DELETED>` | Number of masters/transactions deleted |
| `<LASTVCHID>0</LASTVCHID>` | Master ID of last imported voucher |
| `<LASTMID>0</LASTMID>` | Last Master ID |
| `<COMBINED>0</COMBINED>` | Number of combined masters |
| `<IGNORED>0</IGNORED>` | Number of ignored masters |
| `<ERRORS>0</ERRORS>` | Number of errors while importing the request |
| `<CANCELLED>0</CANCELLED>` | Number of transactions cancelled |
| `</RESPONSE>` | Closing tag of response XML |

#### Other Optional Attributes of a Stock Item

| Name | Usage of the Tag | Tag |
|------|------------------|-----|
| Standard Selling price | To provide standard selling for stock item | `<STANDARDPRICELIST.LIST><DATE>14092016</DATE><RATE>1145.99</RATE></STANDARDPRICELIST.LIST>` |
| Standard Cost price | To provide standard cost for stock item | `<STANDARDCOSTLIST.LIST><DATE>12092016</DATE><RATE>875.23</RATE></STANDARDCOSTLIST.LIST>` |
| Parent | To provide stock group name to stock item name | `<PARENT>"Electronics"</PARENT>` |
| BatchName | To provide batch name | `<BATCHNAME>Apr2016</BATCHNAME>` |
| Opening balance | To provide opening quantity for the item | `<OPENINGBALANCE>25</OPENINGBALANCE>` |
| Opening Rate | To provide opening rate for the item | `<OPENINGRATE>490</OPENINGRATE>` |
| Opening Value | To provide opening value for the item | `<OPENINGVALUE>12250</OPENINGVALUE>` |
| Godown Name | To provide godown name (default: Main Location) | `<GODOWN>Main Location</GODOWN>` |

#### Identify/Map Items Pushed by Third Party Applications

##### Alias

The **Alias** field gets enabled by "Provide aliases along with name?" in stock item master configuration.

| Tag | Data type | Is mandatory | Description |
|-----|-----------|--------------|-------------|
| NAME.LIST | List | Yes | Header of alias list |
| NAME | String | Yes | Alias name |

Third party applications can store multiple unique aliases:

```xml
<NAME.LIST TYPE="String">
    <NAME>Red Striped Shirt</NAME>
    <NAME>Stockno12345</NAME>
    <NAME>TPA-Item-001</NAME>
</NAME.LIST>
```

##### Part No

The **Part No.** field gets enabled by "Use Part Number for stock items?" in Stock item master configuration.

| Tag | Data type | Is mandatory | Description |
|-----|-----------|--------------|-------------|
| MAILINGNAME.LIST | List | Yes | Header of part number list |
| MAILINGNAME | String | Yes | Part number |

Third party applications can store multiple unique Part numbers:

```xml
<MAILINGNAME.LIST TYPE="String">
       <MAILINGNAME>TPA-Stockno-00001</MAILINGNAME>
       <MAILINGNAME>00001</MAILINGNAME>
</MAILINGNAME.LIST>
```

### Units of Measure

Stock Items are purchased or sold based on quantity. Two types of UOMs exist: Simple and Compound. Simple units are for basic requirements (numbers, meters, kilograms, pieces). Compound units combine two UOMs.

#### Simple UOM

**Simple units** are nos, pcs, and so on.

#### Compound UOM

A **Compound unit** is a relation between two Simple Units. Before creating a Compound Unit, ensure two Simple Units already exist.

Example: Compound unit – Doz (Dozen) of 12 Nos (Numbers).

UOM contains the following fields:

| Tag | Data type | Is mandatory | Description |
|-----|-----------|--------------|-------------|
| NAME | String | Yes | Name of the UOM (symbol) |
| ISSIMPLEUNIT | Logical | Yes | Set the unit as simple or compound |
| ORIGINALNAME | String | No | Formal name for the unit |
| DECIMALPLACES | Number | No | Number of decimal places |
| BASEUNITS | String | Yes | Name of base unit (Compound unit) |
| ADDITIONALUNITS | String | Yes | Name of additional unit (Compound unit) |
| CONVERSION | Number | Yes | Conversion factor from base to additional unit (Compound unit) |

### Simple & Compound Unit Creation

#### Simple Unit

```xml
<ENVELOPE>
<HEADER>
<TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
   <REQUESTDESC>
       <REPORTNAME>All Masters     </REPORTNAME>
   </REQUESTDESC>
   <REQUESTDATA>
     <TALLYMESSAGE xmlns:UDF="TallyUDF">
       <UNIT Action = "Create">
       <NAME>Pcs</NAME>
       <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
       <ORIGINALNAME>Pieces </ORIGINALNAME>
       <DECIMALPLACES>2</DECIMALPLACES>
       </UNIT>
       <UNIT Action = "Create">
       <NAME>Doz</NAME>
       <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
       <ORIGINALNAME>Dozen </ORIGINALNAME>
       <DECIMALPLACES>0</DECIMALPLACES>
       </UNIT>
     </TALLYMESSAGE>
       </REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>
```

#### Compound Unit

```xml
<ENVELOPE>
<HEADER>
<TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
   <REQUESTDESC>
         <REPORTNAME>All Masters            </REPORTNAME>
   </REQUESTDESC>
   <REQUESTDATA>
     <TALLYMESSAGE xmlns:UDF="TallyUDF">
         <UNIT Action = "Create">
         <NAME>Dozen of 12 Pieces</NAME>
         <ISSIMPLEUNIT>No</ISSIMPLEUNIT>
         <ORIGINALNAME>Liters</ORIGINALNAME>
         <DECIMALPLACES>2</DECIMALPLACES>
         <BASEUNITS>Doz</BASEUNITS>
         <ADDITIONALUNITS>Pcs</ADDITIONALUNITS>
         <CONVERSION>12</CONVERSION>
         </UNIT>
       </TALLYMESSAGE>
     </REQUESTDATA>
   </IMPORTDATA>
</BODY>
</ENVELOPE>
```

**Note:** In compound unit creation, the `<NAME>` tag value will not be considered. Tally creates the name based on conversion factor.

### Location/Godown

**Location/Godown** is the place where Stock Items are stored. Obtain stock reports for each godown and account for movement of stock between locations.

XML request to create a Location/Godown 'Factory':

```xml
<ENVELOPE>
<HEADER>
       <TALLYREQUEST>Import Data</TALLYREQUEST>
</HEADER>
<BODY>
<IMPORTDATA>
          <REQUESTDESC>
              <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
              <TALLYMESSAGE xmlns:UDF="TallyUDF">
                     <GODOWN Action="Create">
                        <NAME>Factory</NAME>
                     </GODOWN>
              </TALLYMESSAGE>
          </REQUESTDATA>
</IMPORTDATA>
</BODY>
</ENVELOPE>
```

A default godown 'Main Location' is available in Tally. If the feature 'Maintain multiple godowns?' is not enabled, the godown name can be set to 'Main Location' as the default value.

### Guidelines for Inventory Masters

The mandatory tags required to import/create inventory masters in Tally are explained in this document. To understand other tags, create a sample master with required features in Tally and export the same in XML format.

---

## Transactions

The **Voucher** is the document used for recording all types of transactions. Various voucher types available in Tally categorize transactions as Purchase, Sales, Payment, Receipt, Journal, etc.

### Sales Transaction

The **Sales voucher** is used to record sales transactions. A bill is generated on sale of goods or services. Two modes available: 'As voucher' and 'As invoice'.

#### Mandatory XML Tags for Sale Transaction

| Tags | Data Type | Permissible Values | Description |
|------|-----------|-------------------|-------------|
| `VOUCHER VCHTYPE="VOUCHERTYPENAME" ACTION="Create" OBJVIEW="Accounting Voucher View"` | Static Values | | VCHTYPE provides voucher type name, ACTION provides action, OBJVIEW provides object view |
| PERSISTEDVIEW | String | Accounting Voucher View, Invoice Voucher View, Inventory Voucher View, Pay Slip Voucher View, Consumption Voucher View, Multi Consumption Voucher View | Identify Voucher behavior |
| VOUCHERTYPENAME | String | Name of the voucher type | Provide voucher type name |
| DATE | Date | Uni date format yyyymmdd | Provide date for the voucher |
| ISINVOICE | Logical | Boolean | Identify whether voucher should be recorded as invoice or voucher |
| ALLLEDGERENTRIES.LIST | List Tag | | Provide ledger details of the voucher |
| LEDGERNAME | String | Ledger Name | Provide ledger name |
| ISDEEMEDPOSITIVE | Logical | Boolean | Decides whether ledger amount to be debited or credited |
| ISPARTYLEDGER | Logical | Boolean | Identify whether ledger is a party ledger or not |
| AMOUNT | Amount | Amount | Provide amount for the ledger |
| BILLALLOCATIONS.LIST | List Tag | | Opening tag for bill details for party ledger |
| NAME | String | Text | Provide name / number for the bill |
| BILLTYPE | String | Advance, Agst Ref, New Ref, On Account | Identify payment type received from party |
| AMOUNT | Amount | Amount | Provide bill amount |
| /BILLALLOCATIONS.LIST | List Tag | | Closing tag of bill allocation |
| /ALLLEDGERENTRIES.LIST | List Tag | | Closing tag for ledger details |
| ALLINVENTORYENTRIES.LIST | List Tag | | Opening tag for Inventory Entries of voucher |
| STOCKITEMNAME | String | | Provide stock item name |
| ISDEEMEDPOSITIVE | Logical | Boolean | Set to NO for outward transactions |
| ACTUALQTY | Quantity | Number | Provide actual quantity of the item |
| BILLEDQTY | Quantity | Number | Provide billed quantity of the item |
| RATE | Rate | Number | Provide rate for billed quantity |
| AMOUNT | Amount | | Provide amount for the item |
| ACCOUNTINGALLOCATIONS.LIST | List Tag | | Opening tag to provide accounting details for item |
| LEDGERNAME | String | Text | Provide sales / Tax ledger name |
| ISDEEMEDPOSITIVE | Logical | Boolean | Decides whether ledger amount to be debited or credited |
| AMOUNT | Number | Amount | Provide amount for the ledger |
| /ACCOUNTINGALLOCATIONS.LIST | List Tag | | Closing tag for accounting allocations |
| BATCHALLOCATIONS.LIST | List Tag | #NA | Opening tag for Batch allocations |
| GODOWNNAME | String | | Provide godown name |
| BATCHNAME | String | | Provide batch name |
| AMOUNT | Amount | | Provide amount for batch |
| ACTUALQTY | Quantity | | Provide actual quantity |
| BILLEDQTY | Quantity | | Provide billed quantity |
| /BATCHALLOCATIONS.LIST | List Tag | | Closing tag for Batch allocations |
| /ALLINVENTORYENTRIES.LIST | List Tag | | Closing tag for Inventory Entries of voucher |
| /VOUCHER | List Tag | | Closing tag for voucher |

### Sales Transaction – As Voucher

The voucher mode is the traditional way to record an entry with only accounting information in Dr-Cr or By-To format.

Sample XML Request for Creating a sales transaction in voucher mode:

```xml
<ENVELOPE>
<HEADER>
   <VERSION>1</VERSION>
   <TALLYREQUEST>Import</TALLYREQUEST>
   <TYPE>Data</TYPE>
   <ID>Vouchers</ID>
</HEADER>
<BODY>
<DESC>
</DESC>
<DATA>
<TALLYMESSAGE>
<VOUCHER>
    <DATE>20160401</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>1</VOUCHERNUMBER>
    <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
    <ISINVOICE>No</ISINVOICE>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME>ABC Company Limited</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
      <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>-215476.00</AMOUNT>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
         <LEDGERNAME>Sales</LEDGERNAME>
         <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
         <AMOUNT>21546.00</AMOUNT>
     </LEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>
```

**Note 1:** Inventory details can be added by including tags under sales ledger as inventory details are the break-up of sales ledger:

```xml
<INVENTORYALLOCATIONS.LIST>
        <STOCKITEMNAME>SAMSUNG DVD PLAYER</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>21546.00</AMOUNT>
        <ACTUALQTY> 1 nos</ACTUALQTY>
        <BILLEDQTY> 1 nos</BILLEDQTY>
        <BATCHALLOCATIONS.LIST>
         <GODOWNNAME>Factory</GODOWNNAME>
         <BATCHNAME>Primary Batch</BATCHNAME>
         <AMOUNT>21546.00</AMOUNT>
         <ACTUALQTY> 1 nos</ACTUALQTY>
         <BILLEDQTY> 1 nos</BILLEDQTY>
        </BATCHALLOCATIONS.LIST>
       </INVENTORYALLOCATIONS.LIST>
```

**Note 2:** An invoice can be recorded without inventory entries for service bills by changing:

```xml
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<ISINVOICE>Yes</ISINVOICE>
```

### Sales Transaction – As Invoice

The Item invoice recorded in Tally using Invoice mode where calculations can be automated.

Sample XML Request for Creating a Sales Transaction in Invoice Mode:

```xml
<ENVELOPE>
<HEADER>
     <VERSION>1</VERSION>
     <TALLYREQUEST>Import</TALLYREQUEST>
     <TYPE>Data</TYPE>
     <ID>Vouchers</ID>
</HEADER>
<BODY>
<DESC></DESC>
<DATA>
<TALLYMESSAGE>
<VOUCHER>
  <DATE>20160401</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>1</VOUCHERNUMBER>
  <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
  <ISINVOICE>Yes</ISINVOICE>
  <OBJVIEW>Invoice Voucher View</OBJVIEW>
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>ABC Company Limited</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <AMOUNT>-21546.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
       <NAME>1</NAME>
       <BILLTYPE>New Ref</BILLTYPE>
       <AMOUNT>-21546.00</AMOUNT>
   </BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
   <LEDGERNAME>Packing Charges</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>900.00</AMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
   <BASICRATEOFINVOICETAX.LIST TYPE="Number">
   <BASICRATEOFINVOICETAX> 14</BASICRATEOFINVOICETAX>
   </BASICRATEOFINVOICETAX.LIST>
   <ROUNDTYPE/>
   <LEDGERNAME>VAT</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>2646.00</AMOUNT>
</LEDGERENTRIES.LIST>
<ALLINVENTORYENTRIES.LIST>
   <STOCKITEMNAME>Sony Television 14 inches</STOCKITEMNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <RATE>15000.00/nos</RATE>
   <AMOUNT>15000.00</AMOUNT>
   <ACTUALQTY> 1 nos</ACTUALQTY>
   <BILLEDQTY> 1 nos</BILLEDQTY>
    <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>Primary Batch</BATCHNAME>
        <DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
        <AMOUNT>15000.00</AMOUNT>
        <ACTUALQTY> 1 nos</ACTUALQTY>
        <BILLEDQTY> 1 nos</BILLEDQTY>
     </BATCHALLOCATIONS.LIST>
     <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>Sales</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>15000.00</AMOUNT>
      </ACCOUNTINGALLOCATIONS.LIST>
   </ALLINVENTORYENTRIES.LIST>
   <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Samsung DVD Player</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <RATE>3000.00/nos</RATE>
      <AMOUNT>3000.00</AMOUNT>
      <ACTUALQTY> 1 nos</ACTUALQTY>
      <BILLEDQTY> 1 nos</BILLEDQTY>
    <BATCHALLOCATIONS.LIST>
       <GODOWNNAME>Main Location</GODOWNNAME>
       <BATCHNAME>Primary Batch</BATCHNAME>
       <DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
            <AMOUNT>3000.00</AMOUNT>
            <ACTUALQTY> 1 nos</ACTUALQTY>
            <BILLEDQTY> 1 nos</BILLEDQTY>
        </BATCHALLOCATIONS.LIST>
        <ACCOUNTINGALLOCATIONS.LIST>
             <LEDGERNAME>Sales</LEDGERNAME>
             <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
             <AMOUNT>3000.00</AMOUNT>
         </ACCOUNTINGALLOCATIONS.LIST>
       </ALLINVENTORYENTRIES.LIST>
   </VOUCHER>
</TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>
```

### Voucher Alteration

To alter a voucher, a vital piece of information required is the voucher identifier through Master ID, Voucher Number, Voucher Type and date.

> ⚠️ **Caveat (added by this repo):** the official example below uses `TAGNAME="Voucher Number"` (note the space) for lookup. We have NOT independently tested whether this works for Alter. For `cancel-voucher` in our MCP we use `TAGNAME="MasterID"` because empirical testing showed VoucherNumber-based lookup is ambiguous across voucher types. Apply the same caution if implementing Alter.

Sample XML Request for Voucher Alteration:

```xml
<ENVELOPE>
      <HEADER>
         <VERSION>1</VERSION>
         <TALLYREQUEST>Import</TALLYREQUEST>
         <TYPE>Data</TYPE>
         <ID>Vouchers</ID>
      </HEADER>
    <BODY>
    <DESC></DESC>
    <DATA>
    <TALLYMESSAGE>
       <VOUCHER DATE="01-Apr-2016″ TAGNAME ="Voucher Number"
                TAGVALUE="1″ Action="Alter" VCHTYPE = "Sales">
       <NARRATION>Being Goods sold</NARRATION>
       </VOUCHER>
    </TALLYMESSAGE>
    </DATA>
    </BODY>
</ENVELOPE>
```

### Voucher Cancellation

Voucher cancellation is similar to Voucher Alteration. For Voucher Cancellation, Action must be set to "Cancel".

> ⚠️ **Caveat (added by this repo):** see top-of-document note. The official example uses `TAGNAME="VoucherNumber"`; we use `TAGNAME="MasterID"` in our MCP because VoucherNumber is not globally unique. Also note that a successful in-place cancel returns `<ALTERED>1</ALTERED>`, not `<CANCELLED>1</CANCELLED>`.

Sample XML Request for cancellation:

```xml
<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
   <DESC></DESC>
   <DATA>
   <TALLYMESSAGE>
   <VOUCHER DATE="01-Apr-2016″ TAGNAME = "VoucherNumber" TAGVALUE="2″
    ACTION="Cancel" VCHTYPE = "Sales">
      <NARRATION>Being good returned</NARRATION>
   </VOUCHER>
   </TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>
```

### Guidelines for Transactions

To understand or import values of other than mandatory tags, create the expected voucher entry in TallyPrime and export the same in XML format.

#### Examples of Possible Errors

**Error: DESC not found**

Sample XML response:

```xml
<ENVELOPE>
  <HEADER>
     <VERSION>1</VERSION>
     <STATUS>0</STATUS>
   </HEADER>
   <BODY>
     <DATA>DESC not found </DATA>
   </BODY>
</ENVELOPE>
```

**Solution:** Ensure the specified masters in the XML are created and available in Tally.

**Error: Voucher totals do not match!**

Sample XML response:

```xml
<ENVELOPE>
<HEADER>
    <VERSION>1</VERSION>
    <STATUS>0</STATUS>
 </HEADER>
 <BODY>
 <DATA>
 <LINEERROR>Voucher totals do not match! Dr: 20,394.00 Dr Cr: 20,395.00 Cr Diff: 1.00 Cr         </LINEERROR>
   <CREATED>0</CREATED>
   <ALTERED>0</ALTERED>
   <DELETED>0</DELETED>
   <LASTVCHID>0</LASTVCHID>
   <LASTMID>0</LASTMID>
   <COMBINED>0</COMBINED>
   <IGNORED>0</IGNORED>
   <ERRORS>1</ERRORS>
   <CANCELLED>0</CANCELLED>
   <VCHNUMBER>1</VCHNUMBER>
   <DESC></DESC>
   </DATA>
</BODY>
</ENVELOPE>
```

**Solution:** Ensure the total of debit amounts equals the total of credit amounts.

### Prerequisites to Import Vouchers

- Make sure necessary masters (Ledger, Stock Item, UOM, etc.) exist in TallyPrime
- If non-base currencies are used, ensure these currencies are available in TallyPrime
- The totals of Debit values and Credit values of Voucher should be equal
- All dates must follow the YYYYMMDD format

---

## Reports

This section illustrates approaches to get data and reports from Tally through XML request/response.

### Tally Data/Objects

Tally database is an Object Oriented Database Management System (OODBMS). Data for an object is stored as a block, allowing faster retrieval. The Tally File System consists of data files (master, transaction, link masters), Msgfiles (transaction management) and State Files (concurrency control and exclusivity control).

By design, Tally database is hierarchical in nature with objects stored in tree-like structure. Each node can be a tree itself. In this structure, a parent can have multiple children but every child has only one parent. A child can have multiple children, inheriting all characteristics from its parent.

### Reports Structure

Tally creates books of accounts and financial statements based on vouchers entered. Reports present information in comprehensible accounting format. Tags used for sending request to export data from TallyPrime:

`<HEADER>` contains:
- Tag `<TALLYREQUEST>` must contain value **Export**
- Tag `<TYPE>` must contain value **Data**
- Tag `<ID>` should contain the **Name of the Report**

`<BODY>` contains:
- Tag `<DESC>` can contain report configurations like Company Name, Format of export, etc. enclosed within `<STATICVARIABLES>` tag list
- If Report Name specified in `<ID>` tag does not exist within Tally running at specified port, TDL defining the Report & supporting definitions needs to be described and enclosed within tag `<TDL>`

### Gathering Data and Reports from Tally

#### Gathering Data

Three 'type' of requests used for exporting data from Tally:

- **Object** — Get one particular object (e.g., Ledger, Stock Item)
- **Collection** — Get multiple objects (e.g., List of Ledgers, List of Stockitems)
- **Data** — Get reports (e.g., Balance Sheet, Trial Balance)

##### Get Single Ledger

XML request to get Name and Parent of a single ledger from Tally:

```xml
<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>EXPORT</TALLYREQUEST>
<TYPE>OBJECT</TYPE>
<SUBTYPE>Ledger</SUBTYPE>
<ID TYPE="Name">NameofTheLedger</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<FETCHLIST>
<FETCH>Name</FETCH>
<FETCH>Parent</FETCH>
</FETCHLIST>
</DESC>
</BODY>
</ENVELOPE>
```

##### Get All Stock Items

XML request to get data of all stock items from Tally:

```xml
<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Data</TYPE>
<ID>List of Accounts</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
         <AccountType>Stock Items</AccountType>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>
```

##### Get Ledgers of Particular Group

XML request to get ledgers of a particular group 'Bank accounts':

```xml
<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>EXPORT</TALLYREQUEST>
<TYPE>COLLECTION</TYPE>
<ID>List of Ledgers</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
         <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="List of Ledgers" ISMODIFY="Yes">
<ADD>CHILD OF : Bank Accounts</ADD>
<NATIVEMETHOD>Name</NATIVEMETHOD>
<NATIVEMETHOD>Parent</NATIVEMETHOD>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>
```

##### Get Transaction Data for Specific Period

XML request to get data of transactions for a specific period:

```xml
<ENVELOPE>
<HEADER>
         <VERSION>1</VERSION>
         <TALLYREQUEST>Export</TALLYREQUEST>
         <TYPE>Data</TYPE>
         <ID>DayBook</ID>
</HEADER>
<BODY>
<DESC>
    <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <SVFROMDATE TYPE="Date">1-Apr-2016</SVFROMDATE>
              <SVTODATE TYPE="Date">1-Apr-2016</SVTODATE>
    </STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>
```

##### Get Transactions for Specific Period and Voucher Type

XML request to get data of transactions for a specific period and for specific voucher type:

```xml
<ENVELOPE>
 <HEADER>
 <VERSION>1</VERSION>
 <TALLYREQUEST>Export</TALLYREQUEST>
 <TYPE>Data</TYPE>
 <ID>Daybook</ID>
 </HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<REPORT NAME="Day Book" ISMODIFY="Yes" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No">
<LOCAL>Collection : Default : Add :Filter : VchTypeFilter</LOCAL>
<LOCAL>Collection : Default : Add :Fetch  : VoucherTypeName</LOCAL> </REPORT>
<SYSTEM TYPE="Formulae" NAME="VchTypeFilter" ISMODIFY="No" ISFIXED="No" ISINTERNAL="No">$VoucherTypeName=Sales   </SYSTEM>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>
```

### Gathering Reports

#### Get Trial Balance Report

XML request to get the existing report 'Trial Balance' from Tally:

```xml
<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Trial Balance</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>
```

Sample XML response for above request:

```xml
<ENVELOPE>
<DSPACCNAME>
  <DSPDISPNAME>Current Liabilities</DSPDISPNAME>
</DSPACCNAME>
<DSPACCINFO>
<DSPCLDRAMT>
<DSPCLDRAMTA>
</DSPCLDRAMTA>
</DSPCLDRAMT>
  <DSPCLCRAMT>
  <DSPCLCRAMTA>1526292.00</DSPCLCRAMTA>
  </DSPCLCRAMT>
  </DSPACCINFO>
  <DSPACCNAME>
      <DSPDISPNAME>Current Assets</DSPDISPNAME>
  </DSPACCNAME>
  <DSPACCINFO>
  <DSPCLDRAMT>
     <DSPCLDRAMTA>-43092.00</DSPCLDRAMTA>
  </DSPCLDRAMT>
  <DSPCLCRAMT>
     <DSPCLCRAMTA></DSPCLCRAMTA>
  </DSPCLCRAMT>
  </DSPACCINFO>
  <DSPACCNAME>
     <DSPDISPNAME>Sales Accounts</DSPDISPNAME>
  </DSPACCNAME>
  <DSPACCINFO>
  <DSPCLDRAMT>
      <DSPCLDRAMTA></DSPCLDRAMTA>
  </DSPCLDRAMT>
  <DSPCLCRAMT>
      <DSPCLCRAMTA>36000.00</DSPCLCRAMTA>
  </DSPCLCRAMT>
</DSPACCINFO>
  <DSPACCNAME>
      <DSPDISPNAME>Purchase Accounts</DSPDISPNAME>
  </DSPACCNAME>
  <DSPACCINFO>
  <DSPCLDRAMT>
      <DSPCLDRAMTA>-1521000.00</DSPCLDRAMTA>
  </DSPCLDRAMT>
  <DSPCLCRAMT>
      <DSPCLCRAMTA></DSPCLCRAMTA>
  </DSPCLCRAMT>
  </DSPACCINFO>
  <DSPACCNAME>
  <DSPDISPNAME>Indirect Expenses</DSPDISPNAME>
  </DSPACCNAME>
  <DSPACCINFO>
     <DSPCLDRAMT>
          <DSPCLDRAMTA></DSPCLDRAMTA>
     </DSPCLDRAMT>
     <DSPCLCRAMT>
          <DSPCLCRAMTA>1800.00</DSPCLCRAMTA>
     </DSPCLCRAMT>
</DSPACCINFO>
</ENVELOPE>
```

In the above XML request, `<HEADER>` describes the expected result:

- The value of `<TALLYREQUEST>` is **Export**, indicating information needs to be exported from Tally
- The value of `<TYPE>` is **Data**, indicating data needs to be exported from Tally
- The value of `<ID>` must be a **TDL Report Name**
- `<BODY>` Tag contains parameters. Additional settings like format required, company from which data is required, etc. can be passed within `<STATICVARIABLES>` Tag

Example of STATICVARIABLES:

```xml
<STATICVARIABLES>
      <SVCurrentCompany>ABC company Private Limited</SVCurrentCompany>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE TYPE="Date">1-Apr-2016</SVFROMDATE>
      <SVTODATE TYPE="Date">1-Apr-2016</SVTODATE>
</STATICVARIABLES>
```

### Gathering a Customized Report

When a required report is not available at Tally end, the TDL code required for the custom report can be sent through the XML request.

#### Tag `<TDL>`

The tag `<TDL>` is used to specify TDL related information. This tag is specified only when TDL Code required to serve the request is not present in default code of TallyPrime. The complete TDL to be executed is sent within the TDL block. Tally application will respond depending on the TDL request.

Structure:

```xml
<TDL>
<TDLMESSAGE>
TDL request specification
</TDLMESSAGE>
</TDL>
```

The `<TDLMESSAGE>` tag is mandatory inside the `<TDL>` tag. All TDL definitions and attributes are represented as tags.

#### Report Specification in TDL

Header format:

```xml
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Report Name</ID>
</HEADER>
```

In this header format, TallyRequest is **Export** and Type is 'Data'. Therefore, ID must be a name of a Report, specified inside the `<REPORT>` tag within the `<TDL>` tag.

Example:

```xml
<TDL>
<TDLMESSAGE>
<REPORT NAME="TDL Report" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No">
<FORMS>First TDL Form</FORMS>
</REPORT>
                            .
                            .
</TDLMESSAGE>
</TDL>
```

#### Custom Report Example — Simple Trial Balance

XML Request with TDL code for customized report 'Simple Trial Balance':

```xml
<ENVELOPE><HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Data</TYPE>
<ID>Simple Trial balance</ID>
</HEADER>
<BODY>
<DESC>
    <STATICVARIABLES>
      <EXPLODEFLAG>Yes</EXPLODEFLAG>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<REPORT NAME="Simple Trial balance">
<FORMS>Simple Trial balance</FORMS>
<TITLE>"Trial Balance"</TITLE>
</REPORT>
<FORM NAME="Simple Trial balance">
<TOPPARTS>Simple TB Part</TOPPARTS>
<HEIGHT>100% Page</HEIGHT>
<WIDTH>100% Page</WIDTH>
</FORM>
<PART NAME="Simple TB Part">
   <TOPLINES>
     Simple TB Title, Simple TB Details
   </TOPLINES>
   <REPEAT>Simple TB Details : Simple TB Ledgers </REPEAT>
   <SCROLLED>Vertical</SCROLLED>
   <COMMONBORDERS>Yes</COMMONBORDERS>
</PART>
<LINE NAME="Simple TB Title">
    <USE>Simple TB Details</USE>
    <LOCAL>Field : Default : Type : String    </LOCAL>
    <LOCAL>Field : Default : Align : Centre      </LOCAL>
    <LOCAL>Field : Account Name : Set as: "Particulars" </LOCAL>
    <LOCAL>Field : Account Value: Set as: "Amount"</LOCAL>
    <BORDER>Flush Totals</BORDER>
</LINE>
<LINE NAME="Simple TB Details">
    <LEFTFIELDS>Account Name</LEFTFIELDS>
    <RIGHTFIELDS>Account Value</RIGHTFIELDS>
    <XMLTAG>"Accts Info"</XMLTAG >
</LINE>
<FIELD NAME="Account Name">
    <USE>Account Name</USE>
    <SET>$Name</SET>
</FIELD>
<FIELD NAME="Account Value">
    <USE>Account Value</USE>
    <SET>$ClosingBalance</SET>
    <BORDER>Thin Left</BORDER>
</FIELD>
<COLLECTION NAME="Simple TB Ledgers">
<TYPE>Ledger</TYPE>
<FILTERS>NoProfitsimple</FILTERS>
</COLLECTION>
<SYSTEM TYPE="Formulae" NAME="NoProfitSimple">
    NOT $$IsLedgerProfit
</SYSTEM>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>
```

XML Response Received:

```xml
<ENVELOPE>
 <ACCTSINFO>
  <ACCOUNTNAME>Abc Company Limited</ACCOUNTNAME>
  <ACCOUNTVALUE>1,29,377.00</ACCOUNTVALUE>
 </ACCTSINFO>
  <ACCOUNTNAME>Sales</ACCOUNTNAME>
  <ACCOUNTVALUE>1,29,277.00</ACCOUNTVALUE>
 </ACCTSINFO>
…
…
…
</ENVELOPE>
```

**Note:** The feature 'Convert to XML TDL' in TallyPrime Developer allows conversion of projects/files in TDL to XML TDL, simplifying XML request generation.

#### Get Report in HTML Format

XML request to get the report 'Trial Balance' in HTML format:

```xml
<ENVELOPE>
<HEADER>
   <VERSION>1</VERSION>
   <TALLYREQUEST>Export</TALLYREQUEST>
   <TYPE>Data</TYPE>
   <ID>Trial Balance</ID>
</HEADER>
<BODY>
   <DESC>
     <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:HTML</SVEXPORTFORMAT>
          </STATICVARIABLES>
   </DESC>
</BODY>
</ENVELOPE>
```

The HTML content of the response should be saved in an html file (`*.html`) to view the content.

### Guidelines for Reports

#### Frequently Used Accounting Reports

| Name of the Report | Description of the report | Mandatory Variables | Purpose of mandatory variables |
|-------------------|---------------------------|-------------------|-------------------------------|
| Day Book | Details of vouchers for a specified period | | |
| Trial Balance | Opening / transacted / Closing Balances of all accounting groups and ledgers | | |
| Ledger Vouchers | Ledger Account for a ledger | LedgerName | To set the Name of the ledger |
| Ledger Outstandings | Outstanding report for a ledger | LedgerName | To set the Name of the ledger |
| Bills Payable | Outstanding report for Payables | | |
| Bills Receivable | Outstanding report for Receivables | | |
| Group Outstandings | Outstanding report for a group | GroupName | To set the Name of the group |

#### Common Variables Used in Tally Reports

| Name of the Variable | Data Type | Permissible value | Description |
|-------------------|-----------|------------------|-------------|
| SVFROMDATE | Date | Uni date format yyyymmdd | To provide from-date of the period |
| SVTODATE | Date | Uni date format yyyymmdd | To provide the To-date of the period |
| SVEXPORTFORMAT | String | `$$SysName:XML`, `$$SysName:HTML` | To set the format of the report |
| EXPLODEFLAG | Logical | Boolean | To get the report in Detailed or Condensed Mode |

**Note:** All other variables used across reports in Tally can be referred in default TDL available in TallyPrime Developer.

#### Finding Report Name/Code in Default TDL

The TDL code for the required Tally report can be viewed in TallyPrime Developer.

Example: To find the TDL code of the Tally report 'Profit and Loss'

- **Step-1:** Click on menu 'Navigate' and select the option 'Jump to Definition'
- **Step-2:** Select **Report** from the definition list shown in field **Definition Type**
- **Step-3:** Type **Profit and Loss** and select the report from the list of reports shown in field **Definition Name**

The cursor will be jumped to the selected definition.
