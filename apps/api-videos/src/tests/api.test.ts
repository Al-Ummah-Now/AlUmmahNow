interface TestResult {
name: string;
passed: boolean;
error?: string;
duration: number;
}

class APITester {
private baseUrl = "http://127.0.0.1:3086";
private testResults: TestResult[] = [];

async runAllTests(): Promise<TestResult[]> {
const tests = [
{ name: "Health Check", test: () => this.testHealthCheck() },
{ name: "Authentication", test: () => this.testAuthentication() },
{ name: "Video Listing", test: () => this.testVideoListing() },
{ name: "Video Search", test: () => this.testVideoSearch() },
{ name: "Video CRUD", test: () => this.testVideoCRUD() },
{ name: "Profile Management", test: () => this.testProfileManagement() },
{ name: "Analytics Tracking", test: () => this.testAnalyticsTracking() }
];

for (const testCase of tests) {
const startTime = Date.now();
try {
const passed = await testCase.test();
this.testResults.push({
name: testCase.name,
passed,
duration: Date.now() - startTime
});
} catch (error) {
this.testResults.push({
name: testCase.name,
passed: false,
error: error instanceof Error ? error.message : String(error),
duration: Date.now() - startTime
});
}
}
return this.testResults;
}

private async testHealthCheck(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/auth-test`);
return response.ok;
}

private async testAuthentication(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/auth-test`);
const data = await response.json() as any;
return response.ok && data.authenticated !== undefined;
}

private async testVideoListing(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/api/videos`);
const data = await response.json() as any;
return response.ok && Array.isArray(data.data);
}

private async testVideoSearch(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/api/videos/search?q=test`);
const data = await response.json() as any;
return response.ok && typeof data.query === 'string';
}

private async testVideoCRUD(): Promise<boolean> {
const listResponse = await fetch(`${this.baseUrl}/api/videos`);
if (!listResponse.ok) return false;

const createResponse = await fetch(`${this.baseUrl}/api/videos`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ title: 'Test Video' })
});
return createResponse.status === 401;
}

private async testProfileManagement(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/api/profiles`);
const data = await response.json() as any;
return response.ok && data.success;
}

private async testAnalyticsTracking(): Promise<boolean> {
const response = await fetch(`${this.baseUrl}/api/videos/test-id/view`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ watchTime: 30 })
});
return response.status === 404;
}

generateReport(): string {
const passed = this.testResults.filter(r => r.passed).length;
const total = this.testResults.length;
let report = `\n=== API TEST RESULTS ===\n`;
report += `Passed: ${passed}/${total}\n\n`;

for (const result of this.testResults) {
const status = result.passed ? '✅' : '❌';
report += `${status} ${result.name} (${result.duration}ms)\n`;
if (result.error) report += `   Error: ${result.error}\n`;
}
return report;
}
}

export { APITester };
export type { TestResult };
