"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/nexui/button";
import { css, themeVars as theme } from "@yugnex/core";
import { Separator } from "@/components/nexui/separator";

const headerClass = css({
  position: "sticky",
  top: 0,
  zIndex: 50,
  backgroundColor: theme.color.background,
  borderBottom: `1px solid ${theme.color.border}`,
  padding: `${theme.space[4]} ${theme.space[6]}`,
});

const navContainerClass = css({
  maxWidth: "1200px",
  margin: "0 auto",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
});

const logoClass = css({
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: "1.25rem",
  color: theme.color.foreground,
  textDecoration: "none",
});

const linksClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[6],
  "@media (max-width: 768px)": {
    display: "none", // simple fold for mobile
  }
});

const mobileMenuClass = css({
  display: "none",
  "@media (max-width: 768px)": {
    display: "block",
  }
});

const navLinkClass = css({
  fontFamily: "var(--font-body)",
  color: theme.color.mutedForeground,
  textDecoration: "none",
  fontWeight: 500,
  fontSize: "0.875rem",
  ":hover": {
    color: theme.color.foreground,
  }
});

export function Header() {
  const [isAuth, setIsAuth] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const token = document.cookie.match(/(?:(?:^|.*;\s*)token\s*\=\s*([^;]*).*$)|^.*$/)?.[1];
      if (token) {
        const payload = token.split(".")[1];
        if (payload) {
          let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
          while (base64.length % 4 !== 0) {
            base64 += "=";
          }
          const decoded = JSON.parse(atob(base64)) as { exp?: number; role?: string };
          if (decoded.exp && decoded.exp * 1000 < Date.now()) {
            document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
            setIsAuth(false);
            setIsStaff(false);
            return;
          }
          setIsAuth(true);
          setIsStaff(decoded.role === "staff" || decoded.role === "admin");
          return;
        }
      }
    } catch {
      // invalid token
    }
    setIsAuth(false);
    setIsStaff(false);
  }, []);

  const handleSignOut = () => {
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    window.location.assign("/sign-in");
  };

  return (
    <header className={headerClass}>
      <div className={navContainerClass}>
        <Link href="/" className={logoClass}>Brewline</Link>
        <nav className={linksClass}>
          <Link href="/menu" className={navLinkClass}>Menu</Link>
          <Link href="/about" className={navLinkClass}>About</Link>
          <Link href="/contact" className={navLinkClass}>Contact</Link>
          {isAuth ? (
            <>
              {isStaff ? (
                <>
                  <Link href="/staff/dashboard" className={navLinkClass}>Staff Dashboard</Link>
                  <Link href="/staff/menu" className={navLinkClass}>Menu Manager</Link>
                </>
              ) : (
                <Link href="/my-orders" className={navLinkClass}>My Orders</Link>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut}>Sign Out</Button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={navLinkClass}>Sign In</Link>
              <Button asChild size="sm" tone="primary">
                <Link href="/sign-up">Get Started</Link>
              </Button>
            </>
          )}
        </nav>
        <div className={mobileMenuClass}>
          <Button variant="outline" size="sm" onClick={() => setMenuOpen(!menuOpen)}>
            Menu
          </Button>
        </div>
      </div>
      {menuOpen && (
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Link href="/menu" className={navLinkClass}>Menu</Link>
          <Link href="/about" className={navLinkClass}>About</Link>
          <Link href="/contact" className={navLinkClass}>Contact</Link>
          <Separator />
          {isAuth ? (
            <>
              {isStaff ? (
                <>
                  <Link href="/staff/dashboard" className={navLinkClass}>Staff Dashboard</Link>
                  <Link href="/staff/menu" className={navLinkClass}>Menu Manager</Link>
                </>
              ) : (
                <Link href="/my-orders" className={navLinkClass}>My Orders</Link>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut}>Sign Out</Button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={navLinkClass}>Sign In</Link>
              <Button asChild size="sm" tone="primary">
                <Link href="/sign-up">Get Started</Link>
              </Button>
            </>
          )}
        </div>
      )}
    </header>
  );
}