import { SignInForm } from "@/components/auth/SignInForm";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { layoutCss } from "@/lib/styles";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className={layoutCss.pageContainer}>
      <main className={layoutCss.mainContent} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem 1rem" }}>
        <Card style={{ width: "100%", maxWidth: "400px" }}>
          <CardHeader>
            <CardTitle>Welcome Back</CardTitle>
            <CardDescription>Sign in to manage your pre-orders and track pickup times.</CardDescription>
          </CardHeader>
          <CardBody>
            <SignInForm />
          </CardBody>
          <CardFooter style={{ justifyContent: "center" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--nx-color-muted-foreground)", margin: 0 }}>
              Don't have an account? <Link href="/sign-up" style={{ color: "var(--nx-color-primary)", textDecoration: "none" }}>Sign up</Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}