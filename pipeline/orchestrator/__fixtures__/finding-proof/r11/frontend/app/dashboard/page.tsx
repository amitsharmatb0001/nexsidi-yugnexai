"use client";

import { useEffect } from "react";
import { getUserRole } from "@/lib/api";

export default function DashboardRedirect() {
  useEffect(() => {
    const token = document.cookie.match(/(?:(?:^|.*;\s*)token\s*\=\s*([^;]*).*$)|^.*$/)?.[1];
    if (!token) {
      window.location.assign("/sign-in");
      return;
    }
    const role = getUserRole();
    if (role === "staff" || role === "admin") {
      window.location.assign("/staff/dashboard");
    } else {
      window.location.assign("/my-orders");
    }
  }, []);

  return null;
}
