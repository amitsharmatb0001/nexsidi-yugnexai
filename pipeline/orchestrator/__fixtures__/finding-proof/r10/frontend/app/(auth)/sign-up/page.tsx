import { SignUpForm } from "@/components/auth/SignUpForm";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
import { layoutCss } from "@/lib/styles";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className={layoutCss.pageContainer}>
      <main className={layoutCss.mainContent} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem 1rem" }}>
        <Card style={{ width: "100%", maxWidth: "400px" }}>
          <CardHeader>
            <CardTitle>Create an Account</CardTitle>
            <CardDescription>Join Brewline to place digital pre-orders and pay in-store.</CardDescription>
          </CardHeader>
          <CardBody>
            <SignUpForm />
          </CardBody>
          <CardFooter style={{ justifyContent: "center" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--nx-color-muted-foreground)", margin: 0 }}>
              Already have an account? <Link href="/sign-in" style={{ color: "var(--nx-color-primary)", textDecoration: "none" }}>Sign in</Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}