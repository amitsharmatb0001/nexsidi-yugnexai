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

  console.log("Navigating to landing page at http://localhost:3000...");
  await page.goto("http://localhost:3000", { timeout: 10000 });
  await page.screenshot({ path: join(ARTIFACT_DIR, "1_landing.png") });
  console.log("Landing page screenshot saved.");

  console.log("Navigating to sign-up at http://localhost:3000/sign-up...");
  await page.goto("http://localhost:3000/sign-up", { timeout: 10000 });
  await page.screenshot({ path: join(ARTIFACT_DIR, "3_signup.png") });
  console.log("Sign-up page screenshot saved.");

  console.log("Filling sign-up form...");
  await page.fill('input[type="email"]', `test_user_chrome_${Date.now()}@example.com`);
  await page.fill('input[type="password"]', "ChromePassword123456!");
  await page.screenshot({ path: join(ARTIFACT_DIR, "4_signup_filled.png") });
  console.log("Filled sign-up page screenshot saved.");

  console.log("Submitting sign-up form...");
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }),
    page.click('button') // Click the create account button (only one button on form)
  ]);
  
  console.log("Successfully signed up! Current URL:", page.url());
  await page.screenshot({ path: join(ARTIFACT_DIR, "5_dashboard_empty.png") });
  console.log("Empty dashboard page screenshot saved.");

  console.log("Submitting requirement prompt...");
  await page.fill('textarea[placeholder*="Build me"]', "Build me a simple notes app: allow creating and deleting notes, styling with simple dark mode");
  await page.screenshot({ path: join(ARTIFACT_DIR, "7_create_modal_filled.png") });
  
  console.log("Clicking Build button...");
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }),
    page.click('button:has-text("Build")')
  ]);

  console.log("Build triggered! Current URL:", page.url());
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
