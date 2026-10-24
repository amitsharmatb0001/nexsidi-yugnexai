export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface User {
  id: string;
  email: string;
  role: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  is_available: boolean;
  category: string;
}

export interface OrderItem {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  user_id: string;
  pickup_time: string;
  status: string;
  total_price: number;
  created_at: string;
  items: OrderItem[];
}

export async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<{ success: boolean; data?: T; error?: string; [key: string]: any }> {
  const token = typeof document !== "undefined" 
    ? document.cookie.match(/(?:(?:^|.*;\s*)token\s*\=\s*([^;]*).*$)|^.*$/)?.[1] 
    : null;
    
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (typeof document !== "undefined") {
        document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        window.location.assign("/sign-in");
      }
      return { success: false, error: body.error || "Session expired. Please sign in again." };
    }
    if (!res.ok) {
      return { success: false, error: body.error || `Request failed with status ${res.status}` };
    }
    // Handle standard envelopes { success: true, data: ... } or direct payload
    if (typeof body.success === "boolean") {
      return body;
    }
    return { success: true, data: body, ...body };
  } catch (err: any) {
    return { success: false, error: err.message || "Network request failed" };
  }
}

// Menu API helpers
export function getUserRole(): string | null {
  if (typeof document === "undefined") return null;
  const token = document.cookie.match(/(?:(?:^|.*;\s*)token\s*\=\s*([^;]*).*$)|^.*$/)?.[1];
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const json = atob(base64);
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export async function getMenuItems(): Promise<{ success: boolean; items: MenuItem[]; error?: string }> {
  const res = await fetchApi("/api/v1/menu", { method: "GET" });
  if (!res.success && res.error) {
    return { success: false, items: [], error: res.error };
  }
  
  // Extract items from possible response formats
  const rawItems = res.data?.items ?? res.items ?? (Array.isArray(res.data) ? res.data : []);
  const items: MenuItem[] = Array.isArray(rawItems) ? rawItems : [];
  return { success: true, items };
}

export async function createMenuItem(item: {
  name: string;
  description?: string;
  price: number;
  is_available: boolean;
  category: string;
}): Promise<{ success: boolean; item?: MenuItem; error?: string }> {
  const res = await fetchApi("/api/v1/menu", {
    method: "POST",
    body: JSON.stringify(item),
  });

  if (!res.success) {
    return { success: false, error: res.error || "Failed to create menu item" };
  }

  const created = res.data?.item ?? res.item ?? res.data;
  return { success: true, item: created };
}

export async function updateMenuItem(
  id: string,
  updates: {
    name?: string;
    description?: string;
    price?: number;
    is_available?: boolean;
    category?: string;
  }
): Promise<{ success: boolean; item?: MenuItem; error?: string }> {
  const res = await fetchApi(`/api/v1/menu/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

  if (!res.success) {
    return { success: false, error: res.error || "Failed to update menu item" };
  }

  const updated = res.data?.item ?? res.item ?? res.data;
  return { success: true, item: updated };
}

// Order API helpers
export async function createOrder(order: {
  pickup_time: string;
  items: { menu_item_id: string; quantity: number; notes?: string }[];
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  const res = await fetchApi("/api/v1/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });

  if (!res.success) {
    return { success: false, error: res.error || "Failed to place pre-order" };
  }

  const created = res.data?.order ?? res.order ?? res.data;
  return { success: true, order: created };
}

export async function getCustomerOrders(): Promise<{ success: boolean; orders: Order[]; error?: string }> {
  const res = await fetchApi("/api/v1/orders/me", { method: "GET" });
  if (!res.success) {
    return { success: false, orders: [], error: res.error || "Failed to load orders" };
  }

  const rawOrders = res.data?.orders ?? res.orders ?? (Array.isArray(res.data) ? res.data : []);
  const orders: Order[] = Array.isArray(rawOrders) ? rawOrders : [];
  return { success: true, orders };
}

export interface StaffOrder extends Order {
  customer_email: string;
}

export async function getStaffOrders(): Promise<{ success: boolean; orders: StaffOrder[]; error?: string }> {
  const res = await fetchApi("/api/v1/orders", { method: "GET" });
  if (!res.success) {
    return { success: false, orders: [], error: res.error || "Failed to load staff orders" };
  }

  const rawOrders = res.data?.orders ?? res.orders ?? (Array.isArray(res.data) ? res.data : []);
  const orders: StaffOrder[] = Array.isArray(rawOrders) ? rawOrders : [];
  return { success: true, orders };
}

export async function updateOrderStatus(id: string, status: string): Promise<{ success: boolean; order?: Order; error?: string }> {
  const res = await fetchApi(`/api/v1/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

  if (!res.success) {
    return { success: false, error: res.error || "Failed to update order status" };
  }

  const updated = res.data?.order ?? res.order ?? res.data;
  return { success: true, order: updated };
}

