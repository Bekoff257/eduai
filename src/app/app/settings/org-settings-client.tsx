"use client";

import { useState } from "react";
import type { DashboardOrganization, OrganizationMember } from "@/lib/dashboard/organizations";
import type { BusinessSettings } from "@/lib/services/business-settings";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const ROLE_TONE: Record<OrganizationMember["role"], BadgeTone> = {
  owner: "accent",
  admin: "warning",
  staff: "neutral",
};

export function OrgSettingsClient({
  organization,
  initialSettings,
  members,
  canManage,
}: {
  organization: DashboardOrganization;
  initialSettings: BusinessSettings | null;
  members: OrganizationMember[];
  canManage: boolean;
}) {
  const { showToast } = useToast();
  const [orgName, setOrgName] = useState(organization.name);
  const [timezone, setTimezone] = useState(initialSettings?.timezone ?? "UTC");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/organization-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName: orgName.trim(), timezone: timezone.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to save");
      showToast("Organization settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "danger");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organization Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your organization&apos;s basic account settings.</p>
      </div>

      <Card className="space-y-4 p-5">
        <div>
          <Label htmlFor="org-name">Organization name</Label>
          <TextInput
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!canManage}
          />
        </div>

        <div>
          <Label htmlFor="org-timezone">Timezone</Label>
          <TextInput
            id="org-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!canManage}
            placeholder="Asia/Tashkent"
          />
          <p className="mt-1.5 text-xs text-muted">IANA timezone name, e.g. Asia/Tashkent or UTC.</p>
        </div>

        {canManage ? (
          <Button size="sm" onClick={handleSave} isLoading={isSaving}>
            Save changes
          </Button>
        ) : (
          <p className="text-sm text-muted">Ask an organization owner or admin to change these settings.</p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Members</h2>
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.displayName ?? member.email ?? "Unnamed member"}
                </p>
                {member.email && member.displayName && (
                  <p className="truncate text-xs text-muted">{member.email}</p>
                )}
              </div>
              <Badge tone={ROLE_TONE[member.role]}>{member.role}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Inviting new members isn&apos;t available yet — this is coming in a future update.
        </p>
      </Card>
    </div>
  );
}
