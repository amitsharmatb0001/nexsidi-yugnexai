import { Hero } from "@/components/ui/Hero";
import { FeaturedItems } from "@/components/ui/FeaturedItems";
import { layoutCss } from "@/lib/styles";

export const metadata = {
  title: "Brewline | Craft Coffee & Pastries",
  description: "Neighborhood coffee shop offering craft drinks and daily pastries.",
};

export default function HomePage() {
  return (
    <div className={layoutCss.pageContainer}>
      <main className={layoutCss.mainContent}>
        <div className={layoutCss.section}>
          <div className={layoutCss.container}>
            <Hero />
            <FeaturedItems />
          </div>
        </div>
      </main>
    </div>
  );
}