const { chromium } = require("playwright");
const { join } = require("path");

const ARTIFACT_DIR = "C:\\Users\\amits\\...".replace("...", ".gemini\\antigravity\\brain\\35b0f700-99c4-45ab-a7bf-90604f92ce60");

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Navigating to user app landing page at http://localhost:3201...");
  await page.goto("http://localhost:3201");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_1_landing.png") });
  console.log("Screenshot user_app_1_landing.png saved.");

  console.log("Navigating to sign-up...");
  await page.goto("http://localhost:3201/sign-up");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_2_signup.png") });
  console.log("Screenshot user_app_2_signup.png saved.");

  console.log("Filling sign-up form...");
  await page.fill('input[type="email"]', "client@nextech.com");
  await page.fill('input[type="password"]', "password123456");
  // Fill name input if present
  const nameInput = await page.$('input[placeholder*="Name"], input[placeholder*="name"]');
  if (nameInput) {
    await nameInput.fill("Amit Sharma");
  }
  await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_3_signup_filled.png") });

  console.log("Submitting sign-up form...");
  // Wait for button and click
  const signupBtn = await page.$('button, input[type="submit"]');
  if (signupBtn) {
    await signupBtn.click();
  } else {
    // try clicking button with text Sign Up
    await page.click('button:has-text("Sign Up"), button:has-text("Register")');
  }

  await page.waitForTimeout(5000);
  console.log("Current URL after sign-up:", page.url());
  await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_4_dashboard.png") });
  console.log("Screenshot user_app_4_dashboard.png saved.");

  // Let's click tabs on the dashboard if we are there
  if (page.url().includes("dashboard")) {
    console.log("In dashboard. Clicking Service Catalog tab...");
    await page.click('button:has-text("Service Catalog"), [role="tab"]:has-text("Service")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_5_services.png") });
    console.log("Screenshot user_app_5_services.png saved.");

    console.log("Clicking Client Workspace tab...");
    await page.click('button:has-text("Client Workspace"), [role="tab"]:has-text("Workspace")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_6_workspace.png") });
    console.log("Screenshot user_app_6_workspace.png saved.");

    console.log("Clicking Get in Touch tab...");
    await page.click('button:has-text("Get in Touch"), [role="tab"]:has-text("Touch")');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(ARTIFACT_DIR, "user_app_7_contact.png") });
    console.log("Screenshot user_app_7_contact.png saved.");
  }

  await browser.close();
}

run().catch(console.error);
