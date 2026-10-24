export interface TimelineEntry {
  date: string;
  title: string;
  description: string;
}

export const storyTimeline: TimelineEntry[] = [
  {
    date: "2018",
    title: "The Beginning",
    description: "Brewline started as a small pop-up cart, dedicated to single-origin sourcing and precision brewing."
  },
  {
    date: "2020",
    title: "Our Neighborhood Store",
    description: "We opened our single-location physical storefront to serve our community directly with an expanded bakery program."
  },
  {
    date: "2022",
    title: "In-House Roasting",
    description: "Bringing the roast process in-house allowed us to perfect our espresso blend and feature rotating seasonal micro-lots."
  },
  {
    date: "Today",
    title: "Digital Pre-Order",
    description: "To help you skip the line, we launched our digital pre-order platform. Order ahead, select a pickup time, and pay when you arrive."
  }
];