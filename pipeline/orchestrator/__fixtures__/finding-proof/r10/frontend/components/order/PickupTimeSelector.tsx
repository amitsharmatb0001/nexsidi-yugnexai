"use client";

import { useEffect, useState, useMemo } from "react";
import { css, themeVars as theme } from "@yugnex/core";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/nexui/tabs";
import { SelectField } from "@/components/nexui/select";
import { Badge } from "@/components/nexui/badge";

interface PickupTimeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const selectorCardClass = css({
  backgroundColor: "#F3ECE1", // Warm alabaster card
  border: `1px solid #D8D5CC`,
  borderRadius: theme.radius.lg,
  padding: theme.space[6],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
});

const labelClass = css({
  fontFamily: "var(--font-display)",
  fontSize: "1.125rem",
  fontWeight: 600,
  color: "#2C1E18",
  margin: 0,
});

const descClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  color: "rgba(44, 30, 24, 0.75)",
  lineHeight: 1.5,
  margin: 0,
});

const infoClass = css({
  fontFamily: "var(--font-body)",
  fontSize: "0.825rem",
  color: "#2F6F4F", // Accent color
  backgroundColor: "rgba(47, 111, 79, 0.08)",
  padding: theme.space[3],
  borderRadius: theme.radius.md,
  borderLeft: `3px solid #2F6F4F`,
  margin: 0,
});

export default function PickupTimeSelector({ value, onChange, error }: PickupTimeSelectorProps) {
  // Generate available slots
  const todaySlots = useMemo(() => {
    const slots: { value: string; label: string }[] = [];
    const now = new Date();
    
    // Brewline is open 7:00 AM - 4:00 PM
    const start = new Date();
    start.setHours(7, 0, 0, 0);
    
    const end = new Date();
    end.setHours(16, 0, 0, 0);
    
    // Baristas need 15 minutes prep time
    const minTime = new Date(now.getTime() + 15 * 60 * 1000);
    
    const current = new Date(start);
    while (current <= end) {
      if (current > minTime) {
        const timeStr = current.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        slots.push({
          value: current.toISOString(),
          label: `${timeStr} (Today)`,
        });
      }
      current.setMinutes(current.getMinutes() + 15);
    }
    return slots;
  }, []);

  const tomorrowSlots = useMemo(() => {
    const slots: { value: string; label: string }[] = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const start = new Date(tomorrow);
    start.setHours(7, 0, 0, 0);
    
    const end = new Date(tomorrow);
    end.setHours(16, 0, 0, 0);
    
    const current = new Date(start);
    while (current <= end) {
      const timeStr = current.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      slots.push({
        value: current.toISOString(),
        label: `${timeStr} (Tomorrow)`,
      });
      current.setMinutes(current.getMinutes() + 15);
    }
    return slots;
  }, []);

  // Determine active tab
  const hasTodaySlots = todaySlots.length > 0;
  const [activeDay, setActiveDay] = useState<"today" | "tomorrow">(
    hasTodaySlots ? "today" : "tomorrow"
  );

  // Set default value if empty
  useEffect(() => {
    if (!value) {
      if (activeDay === "today" && hasTodaySlots) {
        onChange(todaySlots[0].value);
      } else if (tomorrowSlots.length > 0) {
        onChange(tomorrowSlots[0].value);
      }
    }
  }, [activeDay, todaySlots, tomorrowSlots, value, onChange, hasTodaySlots]);

  // Whenever tab changes, auto-select first option in that tab
  const handleDayChange = (day: string) => {
    const nextDay = day as "today" | "tomorrow";
    setActiveDay(nextDay);
    if (nextDay === "today" && todaySlots.length > 0) {
      onChange(todaySlots[0].value);
    } else if (nextDay === "tomorrow" && tomorrowSlots.length > 0) {
      onChange(tomorrowSlots[0].value);
    }
  };

  const selectOptions = useMemo(() => {
    return activeDay === "today" ? todaySlots : tomorrowSlots;
  }, [activeDay, todaySlots, tomorrowSlots]);

  return (
    <div className={selectorCardClass}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 className={labelClass}>Select Pickup Time</h3>
          <p className={descClass}>Choose when you would like to collect your pre-order.</p>
        </div>
        {!hasTodaySlots && (
          <Badge variant="outline" tone="warning" size="sm">
            Closed for Today
          </Badge>
        )}
      </div>

      <Tabs value={activeDay} onValueChange={handleDayChange}>
        <TabsList>
          <TabsTrigger value="today" disabled={!hasTodaySlots}>
            Today
          </TabsTrigger>
          <TabsTrigger value="tomorrow">
            Tomorrow
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div>
        <SelectField
          placeholder="Choose a convenient slot..."
          options={selectOptions}
          value={value}
          onValueChange={onChange}
          error={error}
        />
      </div>

      <p className={infoClass} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "2px", flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
        <span>
          <strong>In-Store Pickup Only:</strong> Your order will be prepared fresh and waiting at our counter: 
          {" "}<strong>128 Espresso Way, Portland OR</strong>. Pay by cash or card when you pick up.
        </span>
      </p>
    </div>
  );
}
