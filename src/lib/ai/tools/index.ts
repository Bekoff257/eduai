import { searchCustomerTool } from "@/lib/ai/tools/search-customer";
import { getCustomerTool } from "@/lib/ai/tools/get-customer";
import { createCustomerTool } from "@/lib/ai/tools/create-customer";
import { updateCustomerTool } from "@/lib/ai/tools/update-customer";
import { searchCoursesTool } from "@/lib/ai/tools/search-courses";
import { getCourseTool } from "@/lib/ai/tools/get-course";
import { searchCourseGroupsTool } from "@/lib/ai/tools/search-course-groups";
import { checkAvailableAppointmentsTool } from "@/lib/ai/tools/check-available-appointments";
import { createLeadTool } from "@/lib/ai/tools/create-lead";
import { updateLeadTool } from "@/lib/ai/tools/update-lead";
import { createAppointmentTool } from "@/lib/ai/tools/create-appointment";
import { createFollowUpTool } from "@/lib/ai/tools/create-follow-up";
import { getConversationHistoryTool } from "@/lib/ai/tools/get-conversation-history";
import type { AnyToolDefinition } from "@/lib/ai/tools/types";

export const allTools: AnyToolDefinition[] = [
  searchCustomerTool,
  getCustomerTool,
  createCustomerTool,
  updateCustomerTool,
  searchCoursesTool,
  getCourseTool,
  searchCourseGroupsTool,
  checkAvailableAppointmentsTool,
  createLeadTool,
  updateLeadTool,
  createAppointmentTool,
  createFollowUpTool,
  getConversationHistoryTool,
];

export const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

export type { AnyToolDefinition } from "@/lib/ai/tools/types";
