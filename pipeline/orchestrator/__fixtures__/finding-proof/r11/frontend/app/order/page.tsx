import OrderPageClient from "@/components/order/OrderPageClient";

export const metadata = {
  title: "Place a Pre-Order | Brewline Craft Coffee",
  description: "Select from our range of freshly roasted espresso drinks, cold brews, loose-leaf teas, and bakes. Customize your quantities and pickup time.",
};

export default function OrderPage() {
  return <OrderPageClient />;
}
