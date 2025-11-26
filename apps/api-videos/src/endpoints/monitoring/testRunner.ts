import { PublicRoute, AppContext } from "../../base";
import { } from "chanfana";
import { z } from "zod";
import { APITester } from "../../tests/api.test";

export class TestRunner extends PublicRoute {
schema = {
tags: ["Monitoring"],
summary: "Run API Tests",
description: "🔓 **Public Endpoint**: Run comprehensive API tests and return results.",
responses: {
"200": {
description: "Test results",
content: {
"application/json": {
schema: z.object({
summary: z.object({
total: z.number(),
passed: z.number(),
failed: z.number(),
duration: z.number(),
}),
results: z.array(z.object({
name: z.string(),
passed: z.boolean(),
error: z.string().optional(),
duration: z.number(),
})),
report: z.string(),
timestamp: z.string(),
}),
},
},
},
},
};

async handle(c: AppContext) {
const tester = new APITester();
const results = await tester.runAllTests();

const summary = {
total: results.length,
passed: results.filter(r => r.passed).length,
failed: results.filter(r => !r.passed).length,
duration: results.reduce((sum, r) => sum + r.duration, 0),
};

return c.json({
summary,
results,
report: tester.generateReport(),
timestamp: new Date().toISOString(),
});
}
}
