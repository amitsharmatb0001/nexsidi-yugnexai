import MyOrdersPageClient from "@/components/orders/MyOrdersPageClient";

export const metadata = {
  title: "My Pre-Orders | Brewline Coffee Shop",
  description: "Track your active pre-orders, check live status updates (pending, preparing, ready), and view past orders.",
};

export default function MyOrdersPage() {
  return <MyOrdersPageClient />;
}
