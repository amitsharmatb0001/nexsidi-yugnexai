const { chromium } = require("playwright");
const { join } = require("path");

const ARTIFACT_DIR = "C:\\Users\\amits\\.gemini\\antigravity\\brain\\35b0f700-99c4-45ab-a7bf-90604f92ce60";

async function run() {
  console.log("Launching headless Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  page.on("console", msg => console.log("PAGE LOG:", msg.text()));
  page.on("pageerror", err => console.error("PAGE ERROR:", err.message));

  console.log("Navigating to landing page at http://localhost:3000...");
  await page.goto("http://localhost:3000", { timeout: 15000 });
  await page.screenshot({ path: join(ARTIFACT_DIR, "1_landing.png") });
  console.log("Landing page screenshot saved.");

  console.log("Navigating to sign-up at http://localhost:3000/sign-up...");
  await page.goto("http://localhost:3000/sign-up", { timeout: 15000 });
  await page.screenshot({ path: join(ARTIFACT_DIR, "3_signup.png") });
  console.log("Sign-up page screenshot saved.");

  console.log("Waiting 5s for hydration...");
  await page.waitForTimeout(5000);

  console.log("Filling sign-up form...");
  await page.fill('input[type="email"]', `test_user_chrome_${Date.now()}@example.com`);
  await page.fill('input[type="password"]', "ChromePassword123456!");
  await page.screenshot({ path: join(ARTIFACT_DIR, "4_signup_filled.png") });
  console.log("Filled sign-up page screenshot saved.");

  console.log("Submitting sign-up form...");
  await page.click('button');

  console.log("Waiting for dashboard to load...");
  await page.waitForSelector('textarea[placeholder*="Build me"]', { timeout: 15000 });
  
  console.log("Successfully signed up! Current URL:", page.url());
  await page.screenshot({ path: join(ARTIFACT_DIR, "5_dashboard_empty.png") });
  console.log("Empty dashboard page screenshot saved.");

  console.log("Submitting requirement prompt...");
  await page.fill('textarea[placeholder*="Build me"]', "Build me a simple notes app: allow creating and deleting notes, styling with simple dark mode");
  await page.screenshot({ path: join(ARTIFACT_DIR, "7_create_modal_filled.png") });
  
  console.log("Clicking Build button...");
  await page.click('button:has-text("Build")');

  console.log("Waiting for build status page to load (URL change)...");
  await page.waitForURL('**/build/*', { timeout: 20000 });

  console.log("Build page URL loaded. Waiting 5s for page compile and render...");
  await page.waitForTimeout(5000);

  console.log("Build page loaded! Current URL:", page.url());
  await page.screenshot({ path: join(ARTIFACT_DIR, "8_dashboard_with_task.png") });
  console.log("Build progress page screenshot saved.");

  console.log("Closing browser.");
  await browser.close();
  console.log("E2E UI Test complete!");
}

run().catch(err => {
  console.error("Error during E2E UI Test:", err);
  process.exit(1);
});
