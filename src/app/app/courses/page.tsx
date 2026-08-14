import { redirect } from "next/navigation";
import { getDashboardAuth } from "@/lib/dashboard/auth";
import { listCourses } from "@/lib/services/courses";
import { listCourseGroups } from "@/lib/services/course-groups";
import { getBusinessSettings } from "@/lib/services/business-settings";
import { CoursesClient } from "@/app/app/courses/courses-client";

export default async function CoursesPage() {
  const auth = await getDashboardAuth();
  if (auth.status !== "authenticated" || auth.organization.status !== "single") {
    redirect("/login");
  }

  const { organization } = auth.organization;
  const [courses, groups, settings] = await Promise.all([
    listCourses(organization.id),
    listCourseGroups(organization.id),
    getBusinessSettings(organization.id),
  ]);

  return (
    <CoursesClient
      initialCourses={courses}
      initialGroups={groups}
      defaultCurrency={settings?.defaultCurrency ?? "USD"}
    />
  );
}
