import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const jsonResponse = (data: any): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

export const successResponse = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
});

export const xmlPreValidationErrorResponse = (
  validationErrors: string[],
): CallToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        error: "HTML validation failed",
        validation_errors: validationErrors,
        message:
          "The HTML content contains invalid XML formatting. Please check the validation errors above.",
      }),
    },
  ],
});

export const xmlValidButErrorResponse = (error: Error): CallToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        error: error.message,
        html_validation:
          "The HTML format is valid. The error must be related to something else.",
      }),
    },
  ],
});
