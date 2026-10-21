# Stockroom — what to paste into the three Express Build fields

From the brief in `2026-10-08-express-build-test-prompt-stockroom.md`, Section 2, word for word. Nothing from Sections 3–5 goes into the form.

## Project name
Stockroom

## Starting point
Automatic

## Describe the site
Stockroom — stock and purchase orders for small shops in India.

## What you want
Accounts and shop profile
- I sign up with my email and a password, then sign in and out.
- In Settings I enter my shop name, address, state, GSTIN and phone. My purchase orders use these details.

Suppliers
- I add, edit and delete suppliers: name, phone, email, address, state, and an optional GSTIN.
- Each supplier has a page with their details and all their purchase orders.

Products
- I add, edit and delete products: name, SKU (unique within my shop), unit (pcs, kg, litre or box), purchase price per unit in rupees, GST rate (0, 5, 12, 18 or 28 percent), reorder level, and the current stock.

Purchase orders
- I create a purchase order for a supplier with as many lines as I need: product, quantity, price per unit. Quantity can have decimals for kg and litre.
- Each order has an order date and an expected date.
- GST is worked out per line from the product's GST rate. If my shop's state and the supplier's state are the same, the tax is split into CGST and SGST; otherwise it is IGST. Show each line's tax, the subtotal, the total tax and the total. Money must be exact to the paisa.
- Order numbers run in order per shop: PO-2026-0001, PO-2026-0002, and so on. The financial year starts on 1 April and the numbering starts again then.
- Every order is Draft, Ordered, Received or Cancelled. I can mark a Draft as Ordered, an Ordered one as Received or Cancelled, and a Draft as Cancelled.
- When I mark an order Received, its quantities are added to the products' stock. A Received order cannot be changed or cancelled. A Cancelled order cannot be received.

Stock
- Stock can never go below zero.
- I can adjust a product's stock by hand with a reason (damage, count correction, other). Every change to stock, from an order or by hand, is kept in that product's stock history with the date, the amount and the reason.

Dashboard
- Stock value (stock × purchase price, added up), the products at or below their reorder level, how many orders are open (Draft or Ordered) and their total value, and my latest orders.

Finding things
- Search products by name or SKU. Search orders by number or supplier name.

Exports
- Download a purchase order as a PDF I can send to the supplier. Download a CSV of orders for my accountant, and a CSV of current stock.

Look and feel
- Amounts in rupees with Indian digit grouping (₹1,25,000.00). Dates like 12 Sep 2026.
- I use this standing in the shop on my phone, so it must work well on a phone.
- It must look calm, clear and trustworthy, like a finished product from a senior team — not a template, not a demo.
- My data is private: no other shop can ever see my suppliers, products or orders.
