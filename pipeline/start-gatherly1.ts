// Fresh investor-demo build (project #2 of 2 approved) — design-forward
// two-sided marketplace for local experiences/workshops. One-shot launcher,
// same pattern as start-nextech.ts.
import { Client, Connection } from "@temporalio/client";

const projectId = process.argv[2] ?? "gatherly1";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = await client.workflow.start("projectBuildWorkflow", {
  taskQueue: "nexsidi-pipeline",
  workflowId: `project-build-${projectId}`,
  args: [
    projectId,
    "Build Gatherly — a marketplace connecting local hosts running small " +
      "in-person experiences (workshops, classes, tastings, guided walks, " +
      "one-off events) with attendees looking to book them. Two account " +
      "roles: Host (creates and manages listings, sees bookings and earnings) " +
      "and Attendee (browses listings, books a spot, leaves a review after " +
      "attending). Core features: browsable listings with category filtering " +
      "(e.g. food, craft, outdoors, wellness), a listing detail page (photos, " +
      "description, date/time slots, price, host profile, capacity/spots " +
      "remaining), a booking flow (pick a time slot, confirm — mock payment, " +
      "no real charges), a host dashboard (their listings, upcoming bookings, " +
      "total earnings), an attendee dashboard (upcoming and past bookings), " +
      "and a review system (attendees rate and review after a booking's date " +
      "has passed). Pages needed: landing/marketing page, browse/search " +
      "listings, listing detail, booking confirmation, sign in/up, host " +
      "dashboard, attendee dashboard, host's create/edit listing form, " +
      "account settings. Design direction: this must have a genuinely " +
      "distinct, warm, editorial visual identity — real photography-style " +
      "imagery placeholders, considered typography, a color palette that " +
      "feels human and local rather than generic tech-startup blue. This is " +
      "explicitly NOT allowed to look like a template — originality and " +
      "design quality are the primary things being evaluated here.",
  ],
});
console.log("Workflow started:", handle.workflowId);
await conn.close();
