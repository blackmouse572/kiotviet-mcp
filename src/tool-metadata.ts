export type CatalogProfile = "curated" | "full";

export interface ToolGuide {
  purpose: string;
  useWhen: string;
  avoidWhen: string;
  requiredInputs: string[];
  optionalInputs: string[];
  returns: string;
  safety: string;
  pitfalls: string[];
}

export interface ToolMetadata {
  profiles: CatalogProfile[];
  guide: ToolGuide;
}

export const DEFAULT_CATALOG_PROFILE: CatalogProfile = "curated";
export const CATALOG_PROFILE_HEADER = "x-kiotviet-tool-profile";
const VALID_PROFILES = new Set<CatalogProfile>(["curated", "full"]);

export const TOOL_METADATA: Record<string, ToolMetadata> = {
  "products.list": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Browse products with optional filters and pagination.",
      useWhen: "Use when the user wants a product catalog view or needs to narrow results by name, code, category, or inventory-related filters.",
      avoidWhen: "Avoid when you already know one product identifier; use getById, getByCode, or getByBarcode for a direct lookup.",
      requiredInputs: ["No required inputs."],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.code", "params.name", "params.categoryId", "params.includeInventory"],
      returns: "A paged result with total count, paging fields, and a data array of products.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Broad queries can return large result sets, so prefer pageSize and a narrowing filter.", "If inventory context matters, explicitly request inventory-related filters or follow up with inventory tools."],
    },
  },
  "products.search": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Find products by a free-text query such as code or name.",
      useWhen: "Use when the user gives partial text and wants matching products quickly.",
      avoidWhen: "Avoid when the user already knows an exact barcode, code, or product id; direct lookup tools are more reliable.",
      requiredInputs: ["query"],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.categoryId", "params.includeInventory"],
      returns: "A paged list of matching products.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Short or ambiguous queries may match many products.", "Use paging to avoid oversized responses."],
    },
  },
  "products.getById": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one product using its internal KiotViet product id.",
      useWhen: "Use when a previous tool already returned productId and you need the full product record.",
      avoidWhen: "Avoid when the user only knows a code or barcode; use the matching lookup tool first.",
      requiredInputs: ["productId"],
      optionalInputs: ["No optional inputs."],
      returns: "A single product object.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Fails if the id is wrong or from another retailer.", "Do not guess ids; derive them from search or list results."],
    },
  },
  "products.getByCode": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one product by its product code.",
      useWhen: "Use when the user gives an exact product code.",
      avoidWhen: "Avoid for partial text or unknown formatting; use search instead.",
      requiredInputs: ["code"],
      optionalInputs: ["No optional inputs."],
      returns: "A single product object.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Codes usually need to match exactly.", "If nothing is returned, confirm the code spelling before retrying."],
    },
  },
  "products.getByBarcode": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one product by barcode.",
      useWhen: "Use when the user provides a scanned barcode or exact barcode text.",
      avoidWhen: "Avoid when the user only has a product name or category.",
      requiredInputs: ["barcode"],
      optionalInputs: ["No optional inputs."],
      returns: "A single product object.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Barcode must usually be exact.", "Different variants may have different barcodes."],
    },
  },
  "products.getByCategory": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "List products inside one category.",
      useWhen: "Use when the user wants products from a known category id.",
      avoidWhen: "Avoid when the category is unknown by id; find the category first or use broader product listing.",
      requiredInputs: ["categoryId"],
      optionalInputs: ["params.pageSize", "params.currentItem"],
      returns: "A paged list of products in the category.",
      safety: "Read-only. Does not change product data.",
      pitfalls: ["Requires a numeric category id, not a category name.", "Large categories should be paged."],
    },
  },
  "products.getInventoryLevels": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Inspect stock levels across products or locations using inventory filters.",
      useWhen: "Use when the user asks about on-hand inventory, low stock, or inventory status.",
      avoidWhen: "Avoid when the user wants general product details without stock context.",
      requiredInputs: ["No required inputs."],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.branchId", "params.productId", "params.categoryId"],
      returns: "A paged inventory view with product stock information.",
      safety: "Read-only. Does not change inventory.",
      pitfalls: ["Inventory may depend on branch or location, so set branch filters when the user mentions a store.", "Unfiltered calls may be large."],
    },
  },
  "customers.list": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Browse customers with filters and pagination.",
      useWhen: "Use when the user wants a customer list or needs filtering before picking a customer.",
      avoidWhen: "Avoid when the user already knows a customer id or exact phone number.",
      requiredInputs: ["No required inputs."],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.code", "params.contactNumber", "params.name"],
      returns: "A paged list of customer records.",
      safety: "Read-only. Does not change customer data.",
      pitfalls: ["Large customer bases should always be paged.", "Use a direct lookup tool when you have an exact identifier."],
    },
  },
  "customers.search": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Search customers by free-text input such as name, code, or phone fragments.",
      useWhen: "Use when the user gives incomplete customer details and wants matches.",
      avoidWhen: "Avoid when you have an exact contact number or customer id.",
      requiredInputs: ["query"],
      optionalInputs: ["params.pageSize", "params.currentItem"],
      returns: "A paged list of matching customers.",
      safety: "Read-only. Does not change customer data.",
      pitfalls: ["Short queries may match many customers.", "Use paging and confirm the result before taking follow-up actions."],
    },
  },
  "customers.getById": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one customer by internal customer id.",
      useWhen: "Use when a previous result already gave you customerId.",
      avoidWhen: "Avoid when the user only knows phone number or name.",
      requiredInputs: ["customerId"],
      optionalInputs: ["No optional inputs."],
      returns: "A single customer object.",
      safety: "Read-only. Does not change customer data.",
      pitfalls: ["Ids should come from KiotViet results, not guesses.", "A missing id usually means you need a search step first."],
    },
  },
  "customers.getByContactNumber": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one customer using an exact phone or contact number.",
      useWhen: "Use when the user provides a customer phone number.",
      avoidWhen: "Avoid for partial phone fragments; use search instead.",
      requiredInputs: ["contactNumber"],
      optionalInputs: ["No optional inputs."],
      returns: "A single customer object.",
      safety: "Read-only. Does not change customer data.",
      pitfalls: ["The contact number usually needs exact formatting.", "If lookup fails, confirm country code or stored formatting."],
    },
  },
  "orders.list": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Browse sales orders with filters and pagination.",
      useWhen: "Use when the user wants recent orders, open orders, or a filtered order list.",
      avoidWhen: "Avoid when the user already knows an exact order code or id.",
      requiredInputs: ["No required inputs."],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status", "params.branchId", "params.customerId"],
      returns: "A paged list of orders.",
      safety: "Read-only. Does not change order data.",
      pitfalls: ["Order history can be large, so use paging and filters.", "Status and branch filters help avoid noisy results."],
    },
  },
  "orders.getById": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one order by internal order id.",
      useWhen: "Use when you already have orderId from another tool result.",
      avoidWhen: "Avoid when the user only knows an order code or customer details.",
      requiredInputs: ["orderId"],
      optionalInputs: ["No optional inputs."],
      returns: "A single order object.",
      safety: "Read-only. Does not change order data.",
      pitfalls: ["Ids are retailer-specific.", "If the user names an order code, use getByCode instead."],
    },
  },
  "orders.getByCode": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one order by exact order code.",
      useWhen: "Use when the user provides an exact order code from KiotViet.",
      avoidWhen: "Avoid for broad search terms or customer-centric lookups.",
      requiredInputs: ["code"],
      optionalInputs: ["No optional inputs."],
      returns: "A single order object.",
      safety: "Read-only. Does not change order data.",
      pitfalls: ["Order codes usually need exact matching.", "If no result is found, confirm spelling or switch to a broader list/search path."],
    },
  },
  "orders.getByCustomer": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "List orders associated with one customer.",
      useWhen: "Use when the user asks for a customer's order history.",
      avoidWhen: "Avoid when the customer identity is uncertain; resolve the customer first.",
      requiredInputs: ["customerIdentifier"],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status"],
      returns: "A paged list of that customer's orders.",
      safety: "Read-only. Does not change order data.",
      pitfalls: ["Use the exact customer identifier format expected by KiotViet.", "Apply paging to avoid large histories."],
    },
  },
  "orders.getByDateRange": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "List orders created in a specific time window.",
      useWhen: "Use when the user asks for orders during a known period such as today, this week, or a custom range.",
      avoidWhen: "Avoid when the user wants a single known order.",
      requiredInputs: ["fromDate", "toDate"],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status", "params.branchId"],
      returns: "A paged list of orders in the requested date range.",
      safety: "Read-only. Does not change order data.",
      pitfalls: ["Date format must match the SDK expectation.", "Wide date ranges can return many orders."],
    },
  },
  "invoices.list": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Browse invoices with filters and pagination.",
      useWhen: "Use when the user wants invoice history, filtered billing records, or a paged invoice view.",
      avoidWhen: "Avoid when the user already knows an exact invoice id or code.",
      requiredInputs: ["No required inputs."],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status", "params.branchId", "params.customerId"],
      returns: "A paged list of invoices.",
      safety: "Read-only. Does not change invoice data.",
      pitfalls: ["Invoice datasets can be large, so use paging and filters.", "Branch or customer filters help reduce noise."],
    },
  },
  "invoices.getById": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one invoice by internal invoice id.",
      useWhen: "Use when you already have invoiceId from another response.",
      avoidWhen: "Avoid when the user only knows an invoice code or order reference.",
      requiredInputs: ["invoiceId"],
      optionalInputs: ["No optional inputs."],
      returns: "A single invoice object.",
      safety: "Read-only. Does not change invoice data.",
      pitfalls: ["Invoice ids should come from KiotViet data, not guesses.", "If the user has a code, use getByCode."],
    },
  },
  "invoices.getByCode": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "Fetch one invoice by exact invoice code.",
      useWhen: "Use when the user provides a known invoice code.",
      avoidWhen: "Avoid for broad billing investigations or partial text.",
      requiredInputs: ["code"],
      optionalInputs: ["No optional inputs."],
      returns: "A single invoice object.",
      safety: "Read-only. Does not change invoice data.",
      pitfalls: ["Code matching is usually exact.", "If the code is uncertain, use list or date-range tools instead."],
    },
  },
  "invoices.getByCustomer": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "List invoices for one customer.",
      useWhen: "Use when the user wants a customer's invoice history or unpaid invoices tied to a customer.",
      avoidWhen: "Avoid when the customer has not been identified clearly.",
      requiredInputs: ["customerIdentifier"],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status"],
      returns: "A paged list of invoices for the customer.",
      safety: "Read-only. Does not change invoice data.",
      pitfalls: ["Customer identifier format must match KiotViet expectations.", "Use paging for customers with long billing histories."],
    },
  },
  "invoices.getByDateRange": {
    profiles: ["curated", "full"],
    guide: {
      purpose: "List invoices within a specific date range.",
      useWhen: "Use when the user asks for invoices during a reporting period.",
      avoidWhen: "Avoid when the user wants a single known invoice.",
      requiredInputs: ["fromDate", "toDate"],
      optionalInputs: ["params.pageSize", "params.currentItem", "params.status", "params.branchId"],
      returns: "A paged list of invoices in the selected time window.",
      safety: "Read-only. Does not change invoice data.",
      pitfalls: ["Date format must be valid for the SDK.", "Wide ranges may produce large result sets."],
    },
  },
};

export function renderGuideDescription(name: string, generatedDescription: string, metadata: ToolMetadata | undefined): string {
  if (!metadata) {
    const fallback = generatedDescription.trim() || name;
    return `Advanced tool. API-derived description: ${fallback}. Prefer curated tools when possible. Inputs follow the schema exactly.`;
  }

  const { guide } = metadata;
  return [
    `Purpose: ${guide.purpose}`,
    `Use when: ${guide.useWhen}`,
    `Avoid when: ${guide.avoidWhen}`,
    `Required inputs: ${guide.requiredInputs.join("; ")}`,
    `Optional inputs: ${guide.optionalInputs.join("; ")}`,
    `Returns: ${guide.returns}`,
    `Safety: ${guide.safety}`,
    `Watch for: ${guide.pitfalls.join("; ")}`,
  ].join(" ");
}

export function parseCatalogProfile(value: string | undefined, fallback: CatalogProfile = DEFAULT_CATALOG_PROFILE): CatalogProfile | null {
  if (!value) return fallback;
  return VALID_PROFILES.has(value as CatalogProfile) ? (value as CatalogProfile) : null;
}
