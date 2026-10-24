"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { css, themeVars as theme } from "@yugnex/core";

const footerClass = css({
  borderTop: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  padding: `${theme.space[12]} ${theme.space[6]} ${theme.space[6]}`,
});

const containerClass = css({
  maxWidth: "1200px",
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: theme.space[8],
  "@media (min-width: 768px)": {
    gridTemplateColumns: "1fr 1fr 1fr",
  }
});

const columnClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
});

const titleClass = css({
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: "1rem",
  color: theme.color.foreground,
});

const linkClass = css({
  fontFamily: "var(--font-body)",
  color: theme.color.mutedForeground,
  textDecoration: "none",
  fontSize: "0.875rem",
  ":hover": {
    color: theme.color.foreground,
  }
});

const bottomClass = css({
  maxWidth: "1200px",
  margin: `${theme.space[12]} auto 0`,
  paddingTop: theme.space[6],
  borderTop: `1px solid ${theme.color.border}`,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: theme.space[4],
  textAlign: "center",
  color: theme.color.mutedForeground,
  fontSize: "0.75rem",
});

export function Footer() {
  const [isAuth, setIsAuth] = useState(false);
  const [isStaff, setIsStaff] = useState(false);

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
          if (!decoded.exp || decoded.exp * 1000 >= Date.now()) {
            setIsAuth(true);
            setIsStaff(decoded.role === "staff" || decoded.role === "admin");
            return;
          }
        }
      }
    } catch {
      // ignore
    }
    setIsAuth(false);
    setIsStaff(false);
  }, []);

  const handleSignOut = () => {
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    window.location.assign("/sign-in");
  };

  return (
    <footer className={footerClass}>
      <div className={containerClass}>
        <div className={columnClass}>
          <div className={titleClass}>Brewline</div>
          <div className={linkClass}>Craft coffee, local bakery, daily roasting.</div>
        </div>
        <div className={columnClass}>
          <div className={titleClass}>Explore</div>
          <Link href="/menu" className={linkClass}>Menu</Link>
          <Link href="/about" className={linkClass}>Our Story</Link>
          <Link href="/contact" className={linkClass}>Contact & Hours</Link>
        </div>
        <div className={columnClass}>
          <div className={titleClass}>Account</div>
          {isAuth ? (
            <>
              {isStaff ? (
                <>
                  <Link href="/staff/dashboard" className={linkClass}>Staff Dashboard</Link>
                  <Link href="/staff/menu" className={linkClass}>Menu Manager</Link>
                </>
              ) : (
                <Link href="/my-orders" className={linkClass}>My Orders</Link>
              )}
              <button 
                type="button" 
                onClick={handleSignOut} 
                className={linkClass}
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={linkClass}>Sign In</Link>
              <Link href="/sign-up" className={linkClass}>Create Account</Link>
            </>
          )}
        </div>
      </div>
      <div className={bottomClass}>
        <div>© 2026 Brewline. All rights reserved.</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", opacity: 0.75 }}>
          <img src="data:image/png;base64,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" alt="YugNex" width="69" height="48" style={{ height: "24px", width: "auto" }} />
          <div>Developed & Managed by YugNex™</div>
          <div>YugNex™ is a trademark of YugNex Technology (OPC) Private Limited.</div>
        </div>
      </div>
    </footer>
  );
}