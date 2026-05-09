import { supabase } from './config.js';

export { supabase }; // Export supabase for use in other modules

// ===================== DATE UTILITIES =====================
/**
 * Get today's date range using server-side timezone calculation
 * Uses Postgres to ensure consistent results regardless of client timezone
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string, dateStr: string}>}
 */
export async function getTodayDateRange(pharmacyId = null) {
  // Use Postgres to calculate today's date range server-side
  // This ensures accuracy regardless of client timezone
  let query = supabase.rpc('get_today_date_range', { pharmacy_id: pharmacyId });
  
  const { data, error } = await query;
  
  if (error) {
    console.warn('Error getting timezone-aware date range:', error);
    // Fallback to UTC if timezone lookup fails
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
    return {
      start: todayUTC.toISOString(),
      end: tomorrowUTC.toISOString(),
      dateStr: todayUTC.toISOString().split('T')[0]
    };
  }
  
  return data;
}

/**
 * Get week date range using server-side timezone calculation
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getWeekDateRange(pharmacyId = null) {
  // Use Postgres to calculate week date range server-side
  let query = supabase.rpc('get_week_date_range', { pharmacy_id: pharmacyId });
  
  const { data, error } = await query;
  
  if (error) {
    console.warn('Error getting week date range:', error);
    // Fallback to UTC if timezone lookup fails
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const weekAgoUTC = new Date(todayUTC.getTime() - 7 * 24 * 60 * 60 * 1000);
    const tomorrowUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
    return {
      start: weekAgoUTC.toISOString(),
      end: tomorrowUTC.toISOString()
    };
  }
  
  return data;
}

/**
 * Get month date range using server-side timezone calculation
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getMonthDateRange(pharmacyId = null) {
  // Use Postgres to calculate month date range server-side
  let query = supabase.rpc('get_month_date_range', { pharmacy_id: pharmacyId });
  
  const { data, error } = await query;
  
  if (error) {
    console.warn('Error getting month date range:', error);
    // Fallback to UTC if timezone lookup fails
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const monthStartUTC = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const tomorrowUTC = new Date(Date.UTC(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate() + 1, 0, 0, 0, 0));
    return {
      start: monthStartUTC.toISOString(),
      end: tomorrowUTC.toISOString()
    };
  }
  
  return data;
}

/**
 * Get year date range using server-side timezone calculation
 * 
 * @param {string} pharmacyId - Optional pharmacy ID for timezone-aware calculation
 * @returns {Promise<{start: string, end: string}>}
 */
export async function getYearDateRange(pharmacyId = null) {
  // Use Postgres to calculate year date range server-side
  let query = supabase.rpc('get_year_date_range', { pharmacy_id: pharmacyId });
  
  const { data, error } = await query;
  
  if (error) {
    console.warn('Error getting year date range:', error);
    // Fallback to UTC if timezone lookup fails
    const now = new Date();
    const year = now.getUTCFullYear();
    const yearStartUTC = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEndUTC = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    return {
      start: yearStartUTC.toISOString(),
      end: yearEndUTC.toISOString()
    };
  }
  
  return data;
}

// ===================== PHARMACIES =====================
export async function getPharmacies() {
  const { data, error } = await supabase.from('pharmacies').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPharmacy(payload) {
  const { data, error } = await supabase.from('pharmacies').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updatePharmacy(id, payload) {
  const { data, error } = await supabase.from('pharmacies').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ===================== PHARMACY SETTINGS =====================
export async function getPharmacySettings(pharmacyId) {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('id, name, branding_color, currency_code, currency_symbol, tax_enabled, tax_rate, discount_enabled, discount_rules, logo_url, updated_at')
    .eq('id', pharmacyId)
    .single();
  if (error) {
    console.error('Error fetching pharmacy settings:', error);
    throw error;
  }
  return data;
}

export async function updatePharmacySettings(pharmacyId, settings) {
  // Validate required fields
  if (!pharmacyId) throw new Error('Pharmacy ID is required');
  if (!settings) throw new Error('Settings object is required');

  const updatePayload = {
    branding_color: settings.branding_color || '#1976d2',
    currency_code: settings.currency_code || 'USD',
    currency_symbol: settings.currency_symbol || '$',
    tax_enabled: Boolean(settings.tax_enabled),
    tax_rate: parseFloat(settings.tax_rate) || 0,
    discount_enabled: Boolean(settings.discount_enabled),
    discount_rules: settings.discount_rules || { max_discount: 10, min_cart_amount: 0 },
    logo_url: settings.logo_url || '',
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('pharmacies')
    .update(updatePayload)
    .eq('id', pharmacyId)
    .select()
    .single();

  if (error) {
    console.error('Error updating pharmacy settings:', {
      pharmacyId,
      error: error.message,
      details: error.details,
      hint: error.hint
    });
    throw new Error(`Failed to update settings: ${error.message}`);
  }

  return data;
}

// ===================== PROFILES =====================
export async function getProfiles(pharmacyId = null) {
  let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateProfile(id, payload) {
  const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ===================== PRODUCTS =====================
export async function getProducts(pharmacyId, branchId = null) {
  let query = supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
    
  if (branchId) {
    query = query.eq('branch_id', branchId);
  }
  
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

export async function getLowStockProducts(pharmacyId) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .filter('stock_boxes', 'lte', supabase.rpc('low_stock_threshold'));
  if (error) {
    const { data: all } = await supabase.from('products').select('*').eq('pharmacy_id', pharmacyId).eq('is_active', true);
    return (all || []).filter(p => p.stock_boxes <= p.low_stock_threshold);
  }
  return data;
}

export async function createProduct(payload) {
  if (!payload.pharmacy_id) {
    throw new Error('pharmacy_id is required when creating a product');
  }
  if (!payload.branch_id) {
    throw new Error('branch_id is required when creating a product. Please select a branch before importing.');
  }
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, payload) {
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

// ===================== PRODUCT BATCHES (FIFO) =====================
export async function getProductBatches(productId, pharmacyId) {
  const { data, error } = await supabase
    .from('product_batches')
    .select('*')
    .eq('product_id', productId)
    .eq('pharmacy_id', pharmacyId)
    .order('received_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createBatch(payload) {
  const { data, error } = await supabase.from('product_batches').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateBatchStock(batchId, quantityBoxes, quantityUnits) {
  const { data, error } = await supabase
    .from('product_batches')
    .update({ quantity_boxes: quantityBoxes, quantity_units: quantityUnits })
    .eq('id', batchId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== CUSTOMERS =====================
export async function getCustomers(pharmacyId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createCustomer(payload) {
  const { data, error } = await supabase.from('customers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, payload) {
  const { data, error } = await supabase.from('customers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

// ===================== SALES =====================
export async function getSales(pharmacyId, limit = 50) {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getSaleItems(saleId) {
  const { data, error } = await supabase
    .from('sale_items')
    .select('*')
    .eq('sale_id', saleId);
  if (error) {
    console.error(`Error fetching sale_items for ${saleId}:`, error);
    throw error;
  }
  return data || [];
}

export async function enrichSalesWithItems(sales) {
  if (!sales || sales.length === 0) return sales;
  
  try {
    console.log(`[enrichSalesWithItems] Enriching ${sales.length} sales with items`);
    
    // Fetch items for each sale individually (more reliable)
    const enrichedSales = [];
    for (const sale of sales) {
      const items = await getSaleItems(sale.id);
      enrichedSales.push({
        ...sale,
        sale_items: items
      });
    }
    
    const totalItems = enrichedSales.reduce((sum, s) => sum + (s.sale_items?.length || 0), 0);
    console.log(`[enrichSalesWithItems] Success - ${totalItems} total items across ${enrichedSales.length} sales`);
    
    return enrichedSales;
  } catch (err) {
    console.error('[enrichSalesWithItems] Error enriching sales:', {
      error: err,
      message: err.message,
      salesCount: sales?.length
    });
    // Return sales with empty items array if enrichment fails
    return sales.map(sale => ({
      ...sale,
      sale_items: sale.sale_items || []
    }));
  }
}

export async function getSalesToday(pharmacyId, branchId = null) {
  // Use timezone-aware date range
  const todayRange = await getTodayDateRange(pharmacyId);
  
  let query = supabase
    .from('sales')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', todayRange.start)
    .lt('created_at', todayRange.end)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createSale(salePayload, items) {
  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

  // Check for expired products BEFORE creating sale
  for (const item of items) {
    const { data: product } = await supabase.from('products').select('expiry_date').eq('id', item.product_id).single();
    if (product && product.expiry_date) {
      const expiry = new Date(product.expiry_date);
      if (expiry < new Date()) {
        throw new Error(`Cannot sell expired product: ${item.product_name} (Expired: ${product.expiry_date})`);
      }
    }
  }

  // Get pharmacy settings for tax calculation
  const { data: pharmacy } = await supabase.from('pharmacies').select('tax_enabled, tax_rate').eq('id', salePayload.pharmacy_id).single();
  
  let finalTotal = salePayload.total_amount - (salePayload.discount || 0);
  if (pharmacy?.tax_enabled && pharmacy?.tax_rate > 0) {
    const taxAmount = (finalTotal * pharmacy.tax_rate) / 100;
    finalTotal += taxAmount;
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({ ...salePayload, invoice_number: invoiceNumber, total_amount: finalTotal })
    .select()
    .single();
  
  if (saleError) {
    console.error('Sale insert error:', {
      error: saleError,
      code: saleError.code,
      message: saleError.message,
      details: saleError.details,
      hint: saleError.hint,
      payload: { ...salePayload, total_amount: finalTotal, invoice_number: invoiceNumber }
    });
    throw saleError;
  }

  const saleItems = items.map(item => ({
    sale_id: sale.id,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.quantity * item.unit_price
  }));

  const { error: itemsError } = await supabase.from('sale_items').insert(saleItems);
  if (itemsError) throw itemsError;

  for (const item of items) {
    const { data: product, error: productError } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', item.product_id).single();
    if (productError) {
      continue;
    }
    
    if (product) {
      const unitsPerBox = product.units_per_box || 1;
      let totalUnits = (product.stock_boxes * unitsPerBox) + product.stock_units - item.quantity;
      
      const newBoxes = Math.floor(totalUnits / unitsPerBox);
      const newUnits = totalUnits % unitsPerBox;
      
      const { data: updateData, error: updateError } = await supabase.from('products').update({ stock_boxes: Math.max(0, newBoxes), stock_units: Math.max(0, newUnits) }).eq('id', item.product_id).select();
      if (updateError) {
        continue;
      }

      await supabase.from('stock_logs').insert({
        product_id: item.product_id,
        product_name: item.product_name,
        change_type: 'sale',
        quantity_change: -item.quantity,
        notes: `Sale: ${sale.invoice_number}`,
        created_by: salePayload.created_by,
        pharmacy_id: salePayload.pharmacy_id,
        branch_id: salePayload.branch_id
      }).select();
    }
  }

  return sale;
}

// ===================== BRANCHES =====================
export async function getBranches(pharmacyId) {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createBranch(payload) {
  const { data, error } = await supabase.from('branches').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id, payload) {
  const { data, error } = await supabase.from('branches').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ===================== STOCK LOGS =====================
export async function getStockLogs(pharmacyId, limit = 100) {
  const { data, error } = await supabase
    .from('stock_logs')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function addStock(productId, productName, quantity, notes, userId, pharmacyId, branchId = null) {
  const { data: product } = await supabase.from('products').select('stock_boxes, units_per_box, branch_id').eq('id', productId).single();
  if (!product) throw new Error('Product not found');
  
  // Ensure stock is added to product's branch
  const targetBranchId = branchId || product.branch_id;
  if (!targetBranchId) throw new Error('Product must be assigned to a branch');

  const newBoxes = product.stock_boxes + quantity;
  await supabase.from('products').update({ stock_boxes: newBoxes }).eq('id', productId);
  await supabase.from('stock_logs').insert({
    product_id: productId,
    product_name: productName,
    change_type: 'restock',
    quantity_change: quantity,
    notes,
    created_by: userId,
    pharmacy_id: pharmacyId,
    branch_id: targetBranchId
  });
}

// ===================== ANALYTICS =====================
export async function getDashboardStats(pharmacyId, branchId = null) {
  // Use timezone-aware date ranges for all queries
  const todayRange = await getTodayDateRange(pharmacyId);
  const weekRange = await getWeekDateRange(pharmacyId);

  // Build queries based on branchId
  let salesTodayQuery = supabase
    .from('sales')
    .select('total_amount, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', todayRange.start)
    .lt('created_at', todayRange.end)
    .eq('status', 'completed');
    
  let salesWeekQuery = supabase
    .from('sales')
    .select('total_amount, created_at')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekRange.start)
    .lt('created_at', weekRange.end)
    .eq('status', 'completed');
    
  let productsQuery = supabase
    .from('products')
    .select('id, stock_boxes, stock_units, units_per_box, price, low_stock_threshold')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
    
  let lowStockQuery = supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  
  if (branchId) {
    salesTodayQuery = salesTodayQuery.eq('branch_id', branchId);
    salesWeekQuery = salesWeekQuery.eq('branch_id', branchId);
    productsQuery = productsQuery.eq('branch_id', branchId);
    lowStockQuery = lowStockQuery.eq('branch_id', branchId);
  }

  const [salesToday, salesWeek, products, lowStock] = await Promise.all([
    salesTodayQuery,
    salesWeekQuery,
    productsQuery,
    lowStockQuery
  ]);

  if (salesToday.error) throw salesToday.error;
  if (salesWeek.error) throw salesWeek.error;
  if (products.error) throw products.error;
  if (lowStock.error) throw lowStock.error;

  const todayRevenue = (salesToday.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const weekRevenue = (salesWeek.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const allProducts = products.data || [];
  const lowStockItems = (lowStock.data || []).filter(p => p.stock_boxes <= p.low_stock_threshold);
  
  // Calculate total inventory worth (based on selling price)
  const inventoryWorth = allProducts.reduce((sum, p) => {
    const totalUnits = (p.stock_boxes * (p.units_per_box || 1)) + (p.stock_units || 0);
    const productWorth = totalUnits * parseFloat(p.price || 0);
    return sum + productWorth;
  }, 0);

  return {
    todayRevenue,
    weekRevenue,
    todaySalesCount: (salesToday.data || []).length,
    totalProducts: allProducts.length,
    lowStockCount: lowStockItems.length,
    lowStockProducts: lowStockItems,
    inventoryWorth,
    weekSales: salesWeek.data || [],
    lastUpdated: new Date().toISOString() // Add timestamp for cache validation
  };
}

/**
 * Get sales statistics using server-side timezone-aware date range queries
 * This ensures consistent calculations across all time periods
 * 
 * @param {string} pharmacyId - The pharmacy ID
 * @param {string} branchId - Optional branch ID for filtering
 * @returns {Promise<{todayRevenue, weekRevenue, monthRevenue, yearRevenue, totalRevenue, sales}>}
 */
export async function getSalesStats(pharmacyId, branchId = null) {
  // Get all date ranges from server for consistency
  const [todayRange, weekRange, monthRange, yearRange] = await Promise.all([
    getTodayDateRange(pharmacyId),
    getWeekDateRange(pharmacyId),
    getMonthDateRange(pharmacyId),
    getYearDateRange(pharmacyId)
  ]);

  // Build base query
  let baseQuery = supabase
    .from('sales')
    .select('id, total_amount, created_at, invoice_number, payment_method, status')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', 'completed');

  if (branchId) {
    baseQuery = baseQuery.eq('branch_id', branchId);
  }

  // Fetch all completed sales for the queries
  const { data: allSales, error: allSalesError } = await baseQuery;
  if (allSalesError) throw allSalesError;

  // Now do server-side queries for each period using proper date ranges
  let salesTodayQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', todayRange.start)
    .lt('created_at', todayRange.end)
    .eq('status', 'completed');

  let salesWeekQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', weekRange.start)
    .lt('created_at', weekRange.end)
    .eq('status', 'completed');

  let salesMonthQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', monthRange.start)
    .lt('created_at', monthRange.end)
    .eq('status', 'completed');

  let salesYearQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId)
    .gte('created_at', yearRange.start)
    .lt('created_at', yearRange.end)
    .eq('status', 'completed');

  if (branchId) {
    salesTodayQuery = salesTodayQuery.eq('branch_id', branchId);
    salesWeekQuery = salesWeekQuery.eq('branch_id', branchId);
    salesMonthQuery = salesMonthQuery.eq('branch_id', branchId);
    salesYearQuery = salesYearQuery.eq('branch_id', branchId);
  }

  const [salesToday, salesWeek, salesMonth, salesYear] = await Promise.all([
    salesTodayQuery,
    salesWeekQuery,
    salesMonthQuery,
    salesYearQuery
  ]);

  if (salesToday.error) throw salesToday.error;
  if (salesWeek.error) throw salesWeek.error;
  if (salesMonth.error) throw salesMonth.error;
  if (salesYear.error) throw salesYear.error;

  // Calculate totals
  const todayRevenue = (salesToday.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const weekRevenue = (salesWeek.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const monthRevenue = (salesMonth.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const yearRevenue = (salesYear.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
  const totalRevenue = (allSales || []).reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);

  return {
    todayRevenue,
    weekRevenue,
    monthRevenue,
    yearRevenue,
    totalRevenue,
    sales: allSales || []
  };
}

export async function getSuperAdminStats() {
  const [pharmacies, users, sales] = await Promise.all([
    supabase.from('pharmacies').select('id, name, is_active, created_at'),
    supabase.from('profiles').select('id, role'),
    supabase.from('sales').select('total_amount, created_at').eq('status', 'completed')
  ]);

  const totalRevenue = (sales.data || []).reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
  return {
    totalPharmacies: (pharmacies.data || []).length,
    activePharmacies: (pharmacies.data || []).filter(p => p.is_active).length,
    totalUsers: (users.data || []).length,
    totalRevenue,
    pharmacies: pharmacies.data || []
  };
}

// ===================== SUPPLIERS =====================
export async function getSuppliers(pharmacyId) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createSupplier(payload) {
  const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(id, payload) {
  const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

export async function getSupplierPurchaseHistory(supplierId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== PURCHASES (STOCK IN) =====================
export async function getPurchases(pharmacyId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPurchase(payload) {
  const purchaseNumber = `PO-${Date.now().toString().slice(-8)}`;
  const { data, error } = await supabase
    .from('purchases')
    .insert({ ...payload, purchase_number: purchaseNumber })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePurchase(id, payload) {
  const { data, error } = await supabase.from('purchases').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getPurchaseDetails(purchaseId) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('id', purchaseId)
    .single();
  if (error) throw error;
  return data;
}

export async function createPurchaseItem(payload) {
  const { data, error } = await supabase.from('purchase_items').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deletePurchaseItem(id) {
  const { error } = await supabase.from('purchase_items').delete().eq('id', id);
  if (error) throw error;
}

export async function processPurchase(purchaseId) {
  const { error } = await supabase.rpc('process_purchase', { p_purchase_id: purchaseId });
  if (error) throw error;
  return true;
}

// ===================== SALES RETURNS =====================
export async function getSalesReturns(pharmacyId) {
  const { data, error } = await supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createSalesReturn(returnPayload, items) {
  const returnNumber = `RET-${Date.now().toString().slice(-8)}`;
  
  const { data: ret, error: retError } = await supabase
    .from('sales_returns')
    .insert({ ...returnPayload, return_number: returnNumber })
    .select()
    .single();
  if (retError) throw retError;

  const returnItems = items.map(item => ({
    return_id: ret.id,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.quantity * item.unit_price
  }));

  const { error: itemsError } = await supabase.from('return_items').insert(returnItems);
  if (itemsError) throw itemsError;

  // Restore stock for returned items
  for (const item of items) {
    const { data: product } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', item.product_id).single();
    if (product) {
      let totalUnits = (product.stock_boxes * product.units_per_box) + product.stock_units + item.quantity;
      const newBoxes = Math.floor(totalUnits / product.units_per_box);
      const newUnits = totalUnits % product.units_per_box;
      await supabase.from('products').update({ stock_boxes: newBoxes, stock_units: newUnits }).eq('id', item.product_id);

      await supabase.from('stock_logs').insert({
        product_id: item.product_id,
        product_name: item.product_name,
        change_type: 'restock',
        quantity_change: item.quantity,
        notes: `Return: ${ret.return_number}`,
        created_by: returnPayload.created_by,
        pharmacy_id: returnPayload.pharmacy_id
      });
    }
  }

  return ret;
}

// ===================== ADVANCED RETURNS MANAGEMENT =====================
export async function processPartialReturn(returnId, saleId, returnedItems, refundAmount, newTotal) {
  const { error } = await supabase.rpc('process_partial_return', {
    p_return_id: returnId,
    p_sale_id: saleId,
    p_returned_items: returnedItems,
    p_refund_amount: refundAmount,
    p_new_total: newTotal
  });
  if (error) throw error;
  return true;
}

export async function processFullReturn(returnId, saleId, refundAmount) {
  const { error } = await supabase.rpc('process_full_return', {
    p_return_id: returnId,
    p_sale_id: saleId,
    p_refund_amount: refundAmount
  });
  if (error) throw error;
  return true;
}

export async function getBranchReturnStats(pharmacyId, branchId) {
  const { data, error } = await supabase.rpc('get_branch_return_stats', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId
  });
  if (error) throw error;
  return data?.[0] || {};
}

export async function getReturnAuditLog(pharmacyId, returnId = null, limit = 50) {
  let query = supabase
    .from('return_audit_log')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (returnId) query = query.eq('return_id', returnId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getReturnsByStatus(pharmacyId, status, branchId = null) {
  let query = supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', status);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getReturnsByType(pharmacyId, type, branchId = null) {
  let query = supabase
    .from('sales_returns')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('return_type', type);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ===================== STOCK ADJUSTMENTS =====================
export async function getStockAdjustments(pharmacyId) {
  const { data, error } = await supabase
    .from('stock_adjustments')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createStockAdjustment(adjustment) {
  const { data: adj, error: adjError } = await supabase
    .from('stock_adjustments')
    .insert(adjustment)
    .select()
    .single();
  if (adjError) throw adjError;

  // Update product stock
  const { data: product } = await supabase.from('products').select('stock_boxes, stock_units, units_per_box').eq('id', adjustment.product_id).single();
  if (product) {
    let totalUnits = (product.stock_boxes * product.units_per_box) + product.stock_units + adjustment.adjustment_quantity;
    if (totalUnits < 0) totalUnits = 0;
    
    const newBoxes = Math.floor(totalUnits / product.units_per_box);
    const newUnits = totalUnits % product.units_per_box;
    await supabase.from('products').update({ stock_boxes: newBoxes, stock_units: newUnits }).eq('id', adjustment.product_id);
  }

  return adj;
}

// ===================== ALERTS =====================
export async function getAlerts(pharmacyId, unreadOnly = false, branchId = null) {
  let query = supabase
    .from('alerts')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (unreadOnly) query = query.eq('is_read', false);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createAlert(payload) {
  const { data, error } = await supabase.from('alerts').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function markAlertAsRead(id) {
  const { data, error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('Error marking alert as read:', error);
    throw error;
  }
  return data;
}

export async function markAllAlertsAsRead(pharmacyId) {
  const { data, error } = await supabase
    .from('alerts')
    .update({ is_read: true })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_read', false)
    .select();
  if (error) {
    console.error('Error marking all alerts as read:', error);
    throw error;
  }
  return data;
}

export async function generateAlerts(pharmacyId) {
  // Get all active products
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);

  if (!products) return;

  const today = new Date();

  for (const product of products) {
    try {
      // Check for low stock
      if (product.stock_boxes <= product.low_stock_threshold) {
        // Check if alert already exists (don't use .single() as it can throw 406 if no rows)
        const { data: existing } = await supabase
          .from('alerts')
          .select('id')
          .eq('product_id', product.id)
          .eq('alert_type', 'low_stock')
          .eq('is_read', false)
          .limit(1);

        if (!existing || existing.length === 0) {
          await createAlert({
            alert_type: product.stock_boxes === 0 ? 'out_of_stock' : 'low_stock',
            product_id: product.id,
            product_name: product.name,
            current_stock: product.stock_boxes,
            threshold_value: product.low_stock_threshold,
            pharmacy_id: pharmacyId,
            branch_id: product.branch_id
          });
        }
      }

      // Check for expiry
      if (product.expiry_date) {
        const expiryDate = new Date(product.expiry_date);
        const daysToExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));

        if (daysToExpiry < 0) {
          // Expired
          const { data: existing } = await supabase
            .from('alerts')
            .select('id')
            .eq('product_id', product.id)
            .eq('alert_type', 'expiry')
            .eq('is_read', false)
            .limit(1);

          if (!existing || existing.length === 0) {
            await createAlert({
              alert_type: 'expiry',
              product_id: product.id,
              product_name: product.name,
              days_to_expiry: 0,
              pharmacy_id: pharmacyId,
              branch_id: product.branch_id
            });
          }
        } else if (daysToExpiry <= 30) {
          // Expiring soon
          const { data: existing } = await supabase
            .from('alerts')
            .select('id')
            .eq('product_id', product.id)
            .eq('alert_type', 'expiry_30_days')
            .eq('is_read', false)
            .limit(1);

          if (!existing || existing.length === 0) {
            await createAlert({
              alert_type: 'expiry_30_days',
              product_id: product.id,
              product_name: product.name,
              days_to_expiry: daysToExpiry,
              pharmacy_id: pharmacyId,
            branch_id: product.branch_id
            });
          }
        }
      }
    } catch (err) {
      console.error('Error generating alerts for product', product.id, err);
      // Continue with next product instead of failing entirely
    }
  }
}

// ===================== BRANCH MANAGEMENT =====================
export async function updateBranchDetails(branchId, payload) {
  const { data, error } = await supabase.from('branches').update(payload).eq('id', branchId).select().single();
  if (error) throw error;
  return data;
}

export async function getBranchDetails(branchId) {
  const { data, error } = await supabase.from('branches').select('*').eq('id', branchId).single();
  if (error) throw error;
  return data;
}

export async function getBranchDashboard(branchId, pharmacyId) {
  // Get daily sales
  const { data: salesData } = await supabase
    .from('sales')
    .select('total_amount, created_at')
    .eq('branch_id', branchId)
    .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  
  // Get monthly revenue
  const { data: monthlyData } = await supabase
    .from('sales')
    .select('total_amount')
    .eq('branch_id', branchId)
    .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
  
  // Get low stock count - fetch all products and filter locally
  const { data: allProducts } = await supabase
    .from('products')
    .select('id, stock_boxes, low_stock_threshold')
    .eq('branch_id', branchId)
    .eq('is_active', true);
  
  const lowStockCount = allProducts?.filter(p => p.stock_boxes <= p.low_stock_threshold).length || 0;
  
  // Get alerts
  const { data: alertsData } = await supabase
    .from('alerts')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_read', false);
  
  const dailySales = salesData?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;
  const monthlyRevenue = monthlyData?.reduce((sum, sale) => sum + (sale.total_amount || 0), 0) || 0;
  
  return {
    dailySales,
    monthlyRevenue,
    lowStockCount,
    alertCount: alertsData?.length || 0
  };
}

// ===================== STAFF BRANCH ASSIGNMENTS =====================
export async function assignStaffToBranch(staffId, branchId, pharmacyId, roleInBranch) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .insert({ staff_id: staffId, branch_id: branchId, pharmacy_id: pharmacyId, role_in_branch: roleInBranch })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBranchAssignments(branchId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true);
  if (error) throw error;
  
  // Manually fetch staff names from profiles using staff_id
  if (data && data.length > 0) {
    const staffIds = data.map(d => d.staff_id);
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', staffIds);
    
    if (!profileError && profiles) {
      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      return data.map(assignment => ({
        ...assignment,
        profiles: profileMap[assignment.staff_id] || { full_name: 'Unknown', email: '' }
      }));
    }
  }
  
  return data;
}

export async function getStaffBranch(staffId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .select('branch_id')
    .eq('staff_id', staffId)
    .eq('is_active', true);
  
  if (error) throw error;
  
  // Return the first (and should be only) branch assignment
  return data && data.length > 0 ? data[0].branch_id : null;
}

export async function updateStaffAssignment(assignmentId, payload) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .update(payload)
    .eq('id', assignmentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPharmacyStaff(pharmacyId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  if (error) throw error;
  return data;
}

export async function removeStaffFromBranch(assignmentId) {
  const { data, error } = await supabase
    .from('staff_branch_assignments')
    .update({ is_active: false })
    .eq('id', assignmentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== STAFF PERFORMANCE =====================
export async function getStaffPerformance(pharmacyId, branchId = null, periodDate = null) {
  let query = supabase
    .from('staff_performance')
    .select('*, profiles(full_name, email)')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (periodDate) query = query.eq('period_date', periodDate);
  else query = query.eq('period_date', new Date().toISOString().split('T')[0]);
  
  const { data, error } = await query.order('total_sales', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getStaffPerformanceHistory(staffId, days = 30) {
  const { data, error } = await supabase
    .from('staff_performance')
    .select('*')
    .eq('staff_id', staffId)
    .gte('period_date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('period_date', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== BRANCH STOCK TRANSFERS =====================
export async function getBranchTransfers(pharmacyId, branchId = null) {
  let query = supabase
    .from('branch_stock_transfers')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) {
    // Get transfers where this branch is either sender or receiver
    const { data: fromBranch } = await query.eq('from_branch_id', branchId).order('created_at', { ascending: false });
    const { data: toBranch } = await supabase
      .from('branch_stock_transfers')
      .select('*')
      .eq('pharmacy_id', pharmacyId)
      .eq('to_branch_id', branchId)
      .order('created_at', { ascending: false });
    
    const data = [...(fromBranch || []), ...(toBranch || [])];
    const uniqueData = Array.from(new Map(data.map(item => [item.id, item])).values());
    return uniqueData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createStockTransfer(payload) {
  const { data, error } = await supabase
    .from('branch_stock_transfers')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addTransferItem(payload) {
  const { data, error } = await supabase
    .from('branch_transfer_items')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTransferDetails(transferId) {
  const { data, error } = await supabase
    .from('branch_stock_transfers')
    .select('*, branch_transfer_items(*)')
    .eq('id', transferId)
    .single();
  if (error) throw error;
  return data;
}

export async function processStockTransfer(transferId) {
  const { error } = await supabase.rpc('process_branch_transfer', { p_transfer_id: transferId });
  if (error) throw error;
  return true;
}

// ===================== PATIENTS =====================
export async function getPatients(pharmacyId, branchId = null) {
  let query = supabase
    .from('patients')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  
  if (branchId) query = query.eq('branch_id', branchId);
  
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

export async function searchPatients(pharmacyId, searchTerm) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,patient_id_number.ilike.%${searchTerm}%`)
    .limit(10);
  if (error) throw error;
  return data;
}

export async function createPatient(payload) {
  const { data, error } = await supabase
    .from('patients')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePatient(patientId, payload) {
  const { data, error } = await supabase
    .from('patients')
    .update(payload)
    .eq('id', patientId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPatientDetails(patientId) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .single();
  if (error) throw error;
  return data;
}

// ===================== PATIENT VISITS (WITH DOCTOR TRACKING) =====================
export async function getPatientVisits(patientId) {
  const { data, error } = await supabase
    .from('patient_visits')
    .select('*')
    .eq('patient_id', patientId)
    .order('visit_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPatientVisit(payload) {
  const { data, error } = await supabase
    .from('patient_visits')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePatientVisit(visitId, payload) {
  const { data, error } = await supabase
    .from('patient_visits')
    .update(payload)
    .eq('id', visitId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== TREATMENT PAYMENTS (CLINIC REVENUE) =====================
export async function getTreatmentPayments(patientId = null, pharmacyId = null) {
  let query = supabase
    .from('treatment_payments')
    .select('*, patient_visits(symptoms, diagnosis, doctor_name, doctor_specialty)')
    .order('payment_date', { ascending: false });
  
  if (patientId) query = query.eq('patient_id', patientId);
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTreatmentPayment(payload) {
  // Payload: { visit_id, patient_id, amount, payment_method, description, recorded_by, branch_id, pharmacy_id }
  const { data, error } = await supabase
    .from('treatment_payments')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTreatmentPayment(paymentId, payload) {
  const { data, error } = await supabase
    .from('treatment_payments')
    .update(payload)
    .eq('id', paymentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTreatmentPayment(paymentId) {
  const { error } = await supabase
    .from('treatment_payments')
    .delete()
    .eq('id', paymentId);
  if (error) throw error;
  return true;
}

export async function getTreatmentPaymentsReport(pharmacyId, branchId = null, startDate = null, endDate = null) {
  // Get aggregated treatment payment data for reporting
  let query = supabase
    .from('treatment_payments')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('payment_date', startDate);
  if (endDate) query = query.lte('payment_date', endDate);
  
  const { data, error } = await query.order('payment_date', { ascending: false });
  if (error) throw error;
  
  // Calculate totals by payment method
  const totals = {};
  let grandTotal = 0;
  data.forEach(payment => {
    const method = payment.payment_method;
    totals[method] = (totals[method] || 0) + parseFloat(payment.amount);
    grandTotal += parseFloat(payment.amount);
  });
  
  return { payments: data, totals, grandTotal, count: data.length };
}

// ===================== DAILY SALES REPORTS =====================
export async function generateDailySalesReport(pharmacyId, branchId, reportDate) {
  const { error } = await supabase.rpc('generate_daily_sales_report', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId,
    p_report_date: reportDate
  });
  if (error) throw error;
  return true;
}

export async function getDailyReports(pharmacyId, branchId = null, limit = 30, offset = 0) {
  const { data, error } = await supabase.rpc('get_daily_reports', {
    p_pharmacy_id: pharmacyId,
    p_branch_id: branchId,
    p_limit: limit,
    p_offset: offset
  });
  if (error) throw error;
  return data || [];
}

export async function getDailyReportsByDateRange(pharmacyId, branchId = null, startDate = null, endDate = null) {
  let query = supabase
    .from('daily_sales_reports')
    .select('*')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('report_date', startDate);
  if (endDate) query = query.lte('report_date', endDate);
  
  const { data, error } = await query.order('report_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDailyReportDetail(reportId) {
  const { data, error } = await supabase
    .from('daily_sales_reports')
    .select('*')
    .eq('id', reportId)
    .single();
  if (error) throw error;
  return data;
}

// ===================== PRESCRIPTIONS =====================
export async function getPrescriptions(pharmacyId, patientId = null, status = 'active') {
  let query = supabase
    .from('prescriptions')
    .select('*, patients(name, phone)')
    .eq('pharmacy_id', pharmacyId)
    .eq('status', status);
  
  if (patientId) query = query.eq('patient_id', patientId);
  
  const { data, error } = await query.order('prescribed_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPrescription(payload) {
  const { data, error } = await supabase
    .from('prescriptions')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePrescription(prescriptionId, payload) {
  const { data, error } = await supabase
    .from('prescriptions')
    .update(payload)
    .eq('id', prescriptionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fillPrescription(prescriptionId, saleId) {
  const { data, error } = await supabase
    .from('prescription_sales')
    .insert({ prescription_id: prescriptionId, sale_id: saleId })
    .select()
    .single();
  if (error) throw error;
  
  // Update prescription status
  await updatePrescription(prescriptionId, { status: 'filled' });
  return data;
}

export async function getPrescriptionHistory(patientId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('*, prescription_sales(sale_id, filled_date, refill_number)')
    .eq('patient_id', patientId)
    .order('prescribed_date', { ascending: false });
  if (error) throw error;
  return data;
}

// ===================== EXPENSES =====================
// ===================== EXPENSE CATEGORIES (ADMIN MANAGED) =====================
export async function getExpenseCategories(pharmacyId) {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .order('category_name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAllExpenseCategories(pharmacyId) {
  // Admin can see all categories including inactive ones
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .order('category_name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createExpenseCategory(payload) {
  // payload: { pharmacy_id, category_name, description }
  const { data, error } = await supabase
    .from('expense_categories')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateExpenseCategory(categoryId, payload) {
  const { data, error } = await supabase
    .from('expense_categories')
    .update(payload)
    .eq('id', categoryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpenseCategory(categoryId) {
  const { error } = await supabase
    .from('expense_categories')
    .delete()
    .eq('id', categoryId);
  if (error) throw error;
  return true;
}

// ===================== EXPENSES =====================
export async function getExpenses(pharmacyId, branchId = null, startDate = null, endDate = null) {
  let query = supabase
    .from('expenses')
    .select('*, expense_categories(category_name, description)')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) query = query.eq('branch_id', branchId);
  if (startDate) query = query.gte('expense_date', startDate);
  if (endDate) query = query.lte('expense_date', endDate);
  
  const { data, error } = await query.order('expense_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createExpense(payload) {
  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateExpense(expenseId, payload) {
  const { data, error } = await supabase
    .from('expenses')
    .update(payload)
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function approveExpense(expenseId, approvedBy) {
  const { data, error } = await supabase
    .from('expenses')
    .update({ is_approved: true, approved_by: approvedBy })
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getExpenseReport(pharmacyId, branchId = null, startDate, endDate) {
  const expenses = await getExpenses(pharmacyId, branchId, startDate, endDate);
  
  // Group by category name
  const byCategory = {};
  expenses.forEach(exp => {
    const categoryName = exp.expense_categories?.category_name || 'Uncategorized';
    if (!byCategory[categoryName]) byCategory[categoryName] = 0;
    byCategory[categoryName] += parseFloat(exp.amount);
  });
  
  const totalExpenses = Object.values(byCategory).reduce((sum, val) => sum + val, 0);
  
  return { byCategory, totalExpenses, count: expenses.length };
}

export async function getMonthlyExpenseReport(pharmacyId, branchId = null) {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  return getExpenseReport(pharmacyId, branchId, startDate, endDate);
}

export async function calculateNetProfit(pharmacyId, branchId = null, startDate, endDate) {
  // Get revenue
  let salesQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('pharmacy_id', pharmacyId);
  
  if (branchId) salesQuery = salesQuery.eq('branch_id', branchId);
  if (startDate) salesQuery = salesQuery.gte('created_at', startDate);
  if (endDate) salesQuery = salesQuery.lte('created_at', endDate);
  
  const { data: salesData } = await salesQuery;
  const revenue = salesData?.reduce((sum, sale) => sum + sale.total_amount, 0) || 0;
  
  // Get COGS (cost of goods sold)
  let costQuery = supabase
    .from('sale_items')
    .select('sale_id, product_id(cost_price), quantity')
    .neq('product_id', null);
  
  const { data: costData } = await costQuery;
  let cogs = 0;
  if (costData) {
    cogs = costData.reduce((sum, item) => sum + (item.quantity * (item.product_id?.cost_price || 0)), 0);
  }
  
  // Get expenses
  const expenseReport = await getExpenseReport(pharmacyId, branchId, startDate, endDate);
  const totalExpenses = expenseReport.totalExpenses;
  
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - totalExpenses;
  const profitMargin = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0;
  
  return {
    revenue,
    cogs,
    grossProfit,
    totalExpenses,
    netProfit,
    profitMargin
  };
}
