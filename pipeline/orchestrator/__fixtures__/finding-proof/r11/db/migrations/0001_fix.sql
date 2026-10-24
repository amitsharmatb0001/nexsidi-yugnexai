ALTER TABLE order_items ADD COLUMN price NUMERIC(10, 2);
ALTER TABLE order_items ADD COLUMN name TEXT;
UPDATE order_items SET price = menu_items.price, name = menu_items.name FROM menu_items WHERE order_items.menu_item_id = menu_items.id;
ALTER TABLE order_items ALTER COLUMN price SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN name SET NOT NULL;