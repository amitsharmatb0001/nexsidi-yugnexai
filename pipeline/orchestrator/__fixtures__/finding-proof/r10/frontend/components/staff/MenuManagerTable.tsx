"use client";

import { useState } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { MenuItem, createMenuItem, updateMenuItem } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/nexui/button";
import { Input } from "@/components/nexui/input";
import { SelectField } from "@/components/nexui/select";
import { Switch } from "@/components/nexui/switch";
import { Badge } from "@/components/nexui/badge";
import { Skeleton } from "@/components/nexui/skeleton";
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from "@/components/nexui/modal";

interface MenuManagerTableProps {
  items: MenuItem[];
  isLoading: boolean;
  onRefresh: () => void;
}

const tableContainerClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster
  border: `1px solid #D8D5CC`,
  borderRadius: theme.radius.lg,
  overflow: "hidden",
  marginBottom: theme.space[12],
});

const overflowWrapperClass = css({
  overflowX: "auto",
  scrollbarWidth: "thin",
});

const tableClass = css({
  width: "100%",
  borderCollapse: "collapse",
  textAlign: "left",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
});

const thClass = css({
  padding: `${theme.space[4]} ${theme.space[6]}`,
  borderBottom: `1px solid #D8D5CC`,
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  color: "#2C1E18",
  backgroundColor: "#EFEBE4",
});

const tdClass = css({
  padding: `${theme.space[4]} ${theme.space[6]}`,
  borderBottom: `1px solid #D8D5CC`,
  color: "#2C1E18",
  verticalAlign: "middle",
});

const trClass = css({
  ":hover": {
    backgroundColor: "rgba(44, 30, 24, 0.02)",
  }
});

const flexRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
});

const modalFormClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
  padding: theme.space[6],
});

const toggleLabelClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[3],
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#2C1E18",
  userSelect: "none",
});

const actionRowClass = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: theme.space[6],
  gap: theme.space[4],
  flexWrap: "wrap",
});

const filterGroupClass = css({
  display: "flex",
  gap: theme.space[3],
  alignItems: "center",
});

export function MenuManagerTable({ items, isLoading, onRefresh }: MenuManagerTableProps) {
  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Coffee & Espresso");
  const [isAvailable, setIsAvailable] = useState(true);

  // Toggling/Submitting states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Search filter inside table
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = [
    { value: "Coffee & Espresso", label: "Coffee & Espresso" },
    { value: "Cold Brew & Iced Drinks", label: "Cold Brew & Iced Drinks" },
    { value: "Tea & Specialty", label: "Tea & Specialty" },
    { value: "Fresh Pastries & Bakery", label: "Fresh Pastries & Bakery" },
    { value: "Seasonal", label: "Seasonal" },
  ];

  // Open add modal
  const handleOpenAdd = () => {
    setName("");
    setDescription("");
    setPrice("");
    setCategory("Coffee & Espresso");
    setIsAvailable(true);
    setFormError(null);
    setIsAddOpen(true);
  };

  // Open edit modal
  const handleOpenEdit = (item: MenuItem) => {
    setSelectedItem(item);
    setName(item.name);
    setDescription(item.description || "");
    setPrice(item.price.toString());
    setCategory(item.category);
    setIsAvailable(item.is_available);
    setFormError(null);
    setIsEditOpen(true);
  };

  // Handle direct stock toggle
  const handleToggleStock = async (item: MenuItem) => {
    setTogglingId(item.id);
    const res = await updateMenuItem(item.id, { is_available: !item.is_available });
    setTogglingId(null);
    if (res.success) {
      onRefresh();
    } else {
      alert(res.error || "Failed to update item status");
    }
  };

  // Handle Add Form Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setFormError("Name is required");
    if (price === "" || isNaN(parseFloat(price)) || parseFloat(price) < 0) return setFormError("Price must be a non-negative number");

    setIsSubmitting(true);
    setFormError(null);

    const res = await createMenuItem({
      name,
      description: description,
      price: parseFloat(price),
      is_available: isAvailable,
      category,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsAddOpen(false);
      onRefresh();
    } else {
      setFormError(res.error || "Failed to add menu item");
    }
  };

  // Handle Edit Form Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!name.trim()) return setFormError("Name is required");
    if (price === "" || isNaN(parseFloat(price)) || parseFloat(price) < 0) return setFormError("Price must be a non-negative number");

    setIsSubmitting(true);
    setFormError(null);

    const res = await updateMenuItem(selectedItem.id, {
      name,
      description: description,
      price: parseFloat(price),
      is_available: isAvailable,
      category,
    });

    setIsSubmitting(false);

    if (res.success) {
      setIsEditOpen(false);
      onRefresh();
    } else {
      setFormError(res.error || "Failed to update menu item");
    }
  };

  // Internal Filter logic
  const filteredItems = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) || 
      (item.description && item.description.toLowerCase().includes(search.toLowerCase()));
    
    const matchesCat = categoryFilter === "all" || item.category === categoryFilter;
    
    return matchesSearch && matchesCat;
  });

  return (
    <div>
      <div className={actionRowClass}>
        <div className={filterGroupClass}>
          <div style={{ width: "220px" }}>
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ width: "200px" }}>
            <SelectField
              placeholder="All Categories"
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              options={[{ value: "all", label: "All Categories" }, ...categories]}
            />
          </div>
        </div>

        <Button onClick={handleOpenAdd} tone="primary" style={{ backgroundColor: "#2F6F4F", borderColor: "#2F6F4F" }}>
          + Add Menu Item
        </Button>
      </div>

      <div className={tableContainerClass}>
        <div className={overflowWrapperClass}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Item Details</th>
                <th className={thClass}>Category</th>
                <th className={thClass}>Price</th>
                <th className={thClass}>Availability</th>
                <th className={thClass} style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className={tdClass}><Skeleton shape="rect" width="160px" height="20px" /></td>
                    <td className={tdClass}><Skeleton shape="rect" width="100px" height="20px" /></td>
                    <td className={tdClass}><Skeleton shape="rect" width="60px" height="20px" /></td>
                    <td className={tdClass}><Skeleton shape="rect" width="80px" height="20px" /></td>
                    <td className={tdClass} style={{ textAlign: "right" }}><Skeleton shape="rect" width="60px" height="20px" /></td>
                  </tr>
                ))
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className={tdClass} style={{ textAlign: "center", padding: "3rem 1rem", color: "rgba(44, 30, 24, 0.6)" }}>
                    No menu items found. Add items to build Brewline's catalog!
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className={trClass}>
                    <td className={tdClass}>
                      <div style={{ fontWeight: 600, color: "#2C1E18", marginBottom: "0.25rem" }}>{item.name}</div>
                      {item.description && (
                        <div style={{ fontSize: "0.75rem", color: "rgba(44, 30, 24, 0.65)" }}>{item.description}</div>
                      )}
                    </td>
                    <td className={tdClass}>
                      <Badge variant="outline" tone="secondary" size="sm">
                        {item.category}
                      </Badge>
                    </td>
                    <td className={tdClass} style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                      {formatMoney(item.price)}
                    </td>
                    <td className={tdClass}>
                      <div className={flexRowClass}>
                        <Switch
                          checked={item.is_available}
                          onCheckedChange={() => handleToggleStock(item)}
                          disabled={togglingId === item.id}
                        />
                        {item.is_available ? (
                          <Badge variant="soft" tone="success" size="sm">In Stock</Badge>
                        ) : (
                          <Badge variant="soft" tone="destructive" size="sm">Sold Out</Badge>
                        )}
                      </div>
                    </td>
                    <td className={tdClass} style={{ textAlign: "right" }}>
                      <Button variant="outline" size="sm" onClick={() => handleOpenEdit(item)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      <Modal open={isAddOpen} onOpenChange={setIsAddOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add Menu Item</ModalTitle>
          </ModalHeader>

          <form onSubmit={handleAddSubmit}>
            <div className={modalFormClass}>
              {formError && (
                <div style={{ padding: "0.75rem", backgroundColor: "rgba(212, 106, 78, 0.1)", border: "1px solid #D46A4E", borderRadius: theme.radius.md, color: "#D46A4E", fontSize: "0.875rem" }}>
                  {formError}
                </div>
              )}

              <Input
                label="Item Name*"
                placeholder="e.g., Lavender Honey Latte"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <Input
                label="Description"
                placeholder="e.g., Espresso with lavender, wildflower honey, and oat milk."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              <Input
                label="Price (USD)*"
                type="number"
                step="0.01"
                placeholder="e.g., 5.25"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />

              <SelectField
                fieldLabel="Category*"
                value={category}
                onValueChange={setCategory}
                options={categories}
              />

              <div style={{ marginTop: "0.5rem" }}>
                <label className={toggleLabelClass}>
                  <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
                  Initially available in stock for ordering
                </label>
              </div>
            </div>

            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary" isLoading={isSubmitting}>
                Add Item
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onOpenChange={setIsEditOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Edit Menu Item</ModalTitle>
          </ModalHeader>

          <form onSubmit={handleEditSubmit}>
            <div className={modalFormClass}>
              {formError && (
                <div style={{ padding: "0.75rem", backgroundColor: "rgba(212, 106, 78, 0.1)", border: "1px solid #D46A4E", borderRadius: theme.radius.md, color: "#D46A4E", fontSize: "0.875rem" }}>
                  {formError}
                </div>
              )}

              <Input
                label="Item Name*"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <Input
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              <Input
                label="Price (USD)*"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />

              <SelectField
                fieldLabel="Category*"
                value={category}
                onValueChange={setCategory}
                options={categories}
              />

              <div style={{ marginTop: "0.5rem" }}>
                <label className={toggleLabelClass}>
                  <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
                  Available in stock for ordering
                </label>
              </div>
            </div>

            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" tone="primary" isLoading={isSubmitting}>
                Save Changes
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}
