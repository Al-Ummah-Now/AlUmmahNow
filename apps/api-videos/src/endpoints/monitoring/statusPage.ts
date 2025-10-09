import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

export class StatusPage extends OpenAPIRoute {
	schema = {
		tags: ["Monitoring"],
		summary: "API Status Page",
		description: "🔓 **Public Endpoint**: Interactive status page showing the health of all APIs using test entities.",
		responses: {
			"200": {
				description: "Status page HTML",
				content: {
					"text/html": {
						schema: z.string(),
					},
				},
			},
		},
	};

	async handle(c) {
		const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Al-Ummah Now Videos API - Status Page</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 300;
        }

        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .summary {
            display: flex;
            justify-content: space-around;
            padding: 20px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
        }

        .summary-item {
            text-align: center;
            padding: 10px;
        }

        .summary-number {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .summary-label {
            color: #6c757d;
            font-size: 0.9rem;
        }

        .success { color: #28a745; }
        .failure { color: #dc3545; }
        .pending { color: #ffc107; }

        .test-section {
            margin: 20px;
        }

        .section-title {
            font-size: 1.5rem;
            margin-bottom: 15px;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 5px;
        }

        .test-grid {
            display: grid;
            gap: 15px;
            margin-bottom: 30px;
        }

        .test-card {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 15px;
            transition: all 0.3s ease;
            border-left: 4px solid #6c757d;
        }

        .test-card.success {
            border-left-color: #28a745;
            background: #f8fff9;
        }

        .test-card.failure {
            border-left-color: #dc3545;
            background: #fff8f8;
        }

        .test-card.pending {
            border-left-color: #ffc107;
            background: #fffcf3;
        }

        .test-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 10px;
        }

        .test-method {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: bold;
            color: white;
            margin-right: 10px;
        }

        .method-get { background: #28a745; }
        .method-post { background: #007bff; }
        .method-put { background: #ffc107; color: black; }
        .method-delete { background: #dc3545; }

        .test-url {
            font-family: monospace;
            font-size: 0.9rem;
            color: #495057;
        }

        .test-status {
            display: flex;
            align-items: center;
            font-weight: bold;
            font-size: 0.9rem;
        }

        .status-icon {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            margin-right: 8px;
        }

        .status-success { background: #28a745; }
        .status-failure { background: #dc3545; }
        .status-pending { background: #ffc107; }

        .test-details {
            margin-top: 10px;
            font-size: 0.85rem;
            color: #6c757d;
        }

        .test-time {
            color: #28a745;
        }

        .test-error {
            color: #dc3545;
            background: #fff5f5;
            padding: 8px;
            border-radius: 4px;
            margin-top: 8px;
            font-family: monospace;
            font-size: 0.8rem;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #6c757d;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .refresh-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            margin: 20px;
            transition: background 0.3s ease;
        }

        .refresh-btn:hover {
            background: #0056b3;
        }

        .entity-info {
            background: #e3f2fd;
            border: 1px solid #bbdefb;
            border-radius: 6px;
            padding: 15px;
            margin: 20px;
        }

        .entity-info h3 {
            color: #1976d2;
            margin-bottom: 10px;
        }

        .entity-details {
            font-family: monospace;
            font-size: 0.9rem;
            color: #424242;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎥 Al-Ummah Now Videos API</h1>
            <p>Complete API Status Dashboard</p>
        </div>

        <div class="summary">
            <div class="summary-item">
                <div class="summary-number pending" id="total-tests">-</div>
                <div class="summary-label">Total Tests</div>
            </div>
            <div class="summary-item">
                <div class="summary-number success" id="passed-tests">-</div>
                <div class="summary-label">Passed</div>
            </div>
            <div class="summary-item">
                <div class="summary-number failure" id="failed-tests">-</div>
                <div class="summary-label">Failed</div>
            </div>
            <div class="summary-item">
                <div class="summary-number pending" id="test-time">-</div>
                <div class="summary-label">Duration (ms)</div>
            </div>
        </div>

        <div class="entity-info">
            <h3>🧪 Test Entity Information</h3>
            <div class="entity-details">
                <strong>Test Channel ID:</strong> test-channel-001<br>
                <strong>Test Video ID:</strong> test-video-001<br>
                <strong>Test Profile ID:</strong> test-profile-001<br>
                <strong>Test Playlist ID:</strong> test-playlist-001
            </div>
        </div>

        <button class="refresh-btn" onclick="runAllTests()">🔄 Refresh Status</button>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Testing all APIs...</p>
        </div>

        <div id="test-results" style="display: none;">
            <div class="test-section">
                <h2 class="section-title">🏠 Core API Endpoints</h2>
                <div class="test-grid" id="core-tests"></div>
            </div>

            <div class="test-section">
                <h2 class="section-title">📺 Channel API Tests</h2>
                <div class="test-grid" id="channel-tests"></div>
            </div>

            <div class="test-section">
                <h2 class="section-title">🎬 Video API Tests</h2>
                <div class="test-grid" id="video-tests"></div>
            </div>

            <div class="test-section">
                <h2 class="section-title">👤 Profile API Tests</h2>
                <div class="test-grid" id="profile-tests"></div>
            </div>

            <div class="test-section">
                <h2 class="section-title">📋 Playlist API Tests</h2>
                <div class="test-grid" id="playlist-tests"></div>
            </div>

            <div class="test-section">
                <h2 class="section-title">📊 Monitoring & Analytics</h2>
                <div class="test-grid" id="monitoring-tests"></div>
            </div>
        </div>
    </div>

    <script>
        const API_BASE = '';
        const TEST_ENTITIES = {
            channelId: 'test-channel-001',
            videoId: 'test-video-001',
            profileId: 'test-profile-001',
            playlistId: 'test-playlist-001',
            commentId: 'test-comment-001'
        };

        let testResults = [];
        let startTime = 0;

        const API_TESTS = {
            core: [
                { method: 'GET', url: '/health', description: 'Health Check' },
                { method: 'GET', url: '/metrics', description: 'System Metrics' },
                { method: 'GET', url: '/test', description: 'Automated Tests' },
                { method: 'GET', url: '/auth-test', description: 'Authentication Test' }
            ],
            channels: [
                { method: 'GET', url: '/api/channels', description: 'List All Channels' },
                { method: 'GET', url: '/api/channels/' + TEST_ENTITIES.channelId, description: 'Get Test Channel', expectNotFound: true },
                { method: 'POST', url: '/api/channels/' + TEST_ENTITIES.channelId + '/subscriptions', description: 'Subscribe to Channel', expectAuth: true },
                { method: 'DELETE', url: '/api/channels/' + TEST_ENTITIES.channelId + '/subscriptions', description: 'Unsubscribe from Channel', expectAuth: true }
            ],
            videos: [
                { method: 'GET', url: '/api/videos', description: 'List All Videos' },
                { method: 'GET', url: '/api/videos/search?q=test', description: 'Search Videos' },
                { method: 'GET', url: '/api/videos/' + TEST_ENTITIES.videoId, description: 'Get Test Video', expectNotFound: true },
                { method: 'POST', url: '/api/videos/' + TEST_ENTITIES.videoId + '/view', description: 'Track Video View', expectNotFound: true },
                { method: 'POST', url: '/api/videos', description: 'Create Video', expectAuth: true },
                { method: 'PUT', url: '/api/videos/' + TEST_ENTITIES.videoId, description: 'Update Video', expectAuth: true },
                { method: 'DELETE', url: '/api/videos/' + TEST_ENTITIES.videoId, description: 'Delete Video', expectAuth: true },
                { method: 'GET', url: '/api/videos/' + TEST_ENTITIES.videoId + '/upload-status', description: 'Get Upload Status', expectAuth: true }
            ],
            profiles: [
                { method: 'GET', url: '/api/profiles', description: 'List All Profiles' },
                { method: 'GET', url: '/api/profiles/' + TEST_ENTITIES.profileId, description: 'Get Test Profile', expectNotFound: true },
                { method: 'POST', url: '/api/profiles', description: 'Create Profile', expectAuth: true },
                { method: 'PUT', url: '/api/profiles/' + TEST_ENTITIES.profileId, description: 'Update Profile', expectAuth: true },
                { method: 'DELETE', url: '/api/profiles/' + TEST_ENTITIES.profileId, description: 'Delete Profile', expectAuth: true },
                { method: 'GET', url: '/api/profiles/watch-history', description: 'Get Watch History', expectAuth: true },
                { method: 'POST', url: '/api/profiles/watch-history', description: 'Add to Watch History', expectAuth: true }
            ],
            playlists: [
                { method: 'GET', url: '/api/playlists', description: 'List All Playlists' },
                { method: 'GET', url: '/api/playlists/' + TEST_ENTITIES.playlistId, description: 'Get Test Playlist', expectNotFound: true },
                { method: 'POST', url: '/api/playlists', description: 'Create Playlist', expectAuth: true },
                { method: 'PATCH', url: '/api/playlists/' + TEST_ENTITIES.playlistId, description: 'Update Playlist', expectAuth: true },
                { method: 'DELETE', url: '/api/playlists/' + TEST_ENTITIES.playlistId, description: 'Delete Playlist', expectAuth: true },
                { method: 'POST', url: '/api/playlists/' + TEST_ENTITIES.playlistId + '/videos', description: 'Add Video to Playlist', expectAuth: true }
            ],
            monitoring: [
                { method: 'GET', url: '/openapi.json', description: 'OpenAPI Specification' },
                { method: 'GET', url: '/', description: 'API Documentation Root' }
            ]
        };

        async function testEndpoint(test) {
            const startTime = Date.now();
            
            try {
                const options = {
                    method: test.method,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                // Add test body data for POST/PUT/PATCH requests
                if (['POST', 'PUT', 'PATCH'].includes(test.method)) {
                    if (test.url.includes('/videos') && !test.url.includes('view') && !test.url.includes('upload')) {
                        options.body = JSON.stringify({ title: 'Test Video', description: 'Test video for API status check' });
                    } else if (test.url.includes('/profiles') && !test.url.includes('watch-history')) {
                        options.body = JSON.stringify({ email: 'test@example.com', userName: 'TestUser' });
                    } else if (test.url.includes('/channels')) {
                        options.body = JSON.stringify({ name: 'Test Channel' });
                    } else if (test.url.includes('/playlists')) {
                        options.body = JSON.stringify({ title: 'Test Playlist' });
                    } else if (test.url.includes('/watch-history')) {
                        options.body = JSON.stringify({ videoId: TEST_ENTITIES.videoId, watchTime: 30 });
                    } else if (test.url.includes('/view')) {
                        options.body = JSON.stringify({ watchTime: 30, deviceType: 'desktop' });
                    }
                }

                const response = await fetch(API_BASE + test.url, options);
                const duration = Date.now() - startTime;
                
                let success = false;
                let statusText = response.status + ' ' + response.statusText;
                
                // Determine success based on expected behavior
                if (test.expectAuth && (response.status === 401 || response.status === 403)) {
                    success = true;
                    statusText += ' (Auth Required - Expected)';
                } else if (test.expectNotFound && response.status === 404) {
                    success = true;
                    statusText += ' (Not Found - Expected)';
                } else if (response.ok) {
                    success = true;
                } else if (response.status >= 400 && response.status < 500) {
                    // Client errors might be expected for some tests
                    success = !test.expectAuth && !test.expectNotFound ? false : true;
                }

                return {
                    ...test,
                    success,
                    status: response.status,
                    statusText,
                    duration,
                    error: null
                };
            } catch (error) {
                return {
                    ...test,
                    success: false,
                    status: 0,
                    statusText: 'Network Error',
                    duration: Date.now() - startTime,
                    error: error.message
                };
            }
        }

        function createTestCard(result) {
            const card = document.createElement('div');
            card.className = \`test-card \${result.success ? 'success' : 'failure'}\`;
            
            const methodClass = 'method-' + result.method.toLowerCase();
            const statusClass = result.success ? 'status-success' : 'status-failure';
            
            card.innerHTML = \`
                <div class="test-header">
                    <div>
                        <span class="test-method \${methodClass}">\${result.method}</span>
                        <span class="test-url">\${result.url}</span>
                    </div>
                    <div class="test-status">
                        <div class="status-icon \${statusClass}"></div>
                        \${result.success ? 'PASS' : 'FAIL'}
                    </div>
                </div>
                <div class="test-details">
                    <strong>\${result.description}</strong><br>
                    Status: \${result.statusText}<br>
                    <span class="test-time">Response Time: \${result.duration}ms</span>
                    \${result.error ? \`<div class="test-error">Error: \${result.error}</div>\` : ''}
                </div>
            \`;
            
            return card;
        }

        function updateSummary() {
            const totalTests = testResults.length;
            const passedTests = testResults.filter(r => r.success).length;
            const failedTests = totalTests - passedTests;
            const totalDuration = testResults.reduce((sum, r) => sum + r.duration, 0);

            document.getElementById('total-tests').textContent = totalTests;
            document.getElementById('passed-tests').textContent = passedTests;
            document.getElementById('failed-tests').textContent = failedTests;
            document.getElementById('test-time').textContent = totalDuration;
        }

        async function runAllTests() {
            testResults = [];
            startTime = Date.now();
            
            // Show loading
            document.getElementById('loading').style.display = 'block';
            document.getElementById('test-results').style.display = 'none';
            
            // Clear previous results
            ['core-tests', 'channel-tests', 'video-tests', 'profile-tests', 'playlist-tests', 'monitoring-tests']
                .forEach(id => document.getElementById(id).innerHTML = '');

            try {
                // Run all tests
                for (const [category, tests] of Object.entries(API_TESTS)) {
                    for (const test of tests) {
                        const result = await testEndpoint(test);
                        testResults.push(result);
                        
                        // Add to appropriate section
                        const sectionId = category + '-tests';
                        const section = document.getElementById(sectionId);
                        if (section) {
                            section.appendChild(createTestCard(result));
                        }
                    }
                }

                updateSummary();
                
            } finally {
                // Hide loading and show results
                document.getElementById('loading').style.display = 'none';
                document.getElementById('test-results').style.display = 'block';
            }
        }

        // Run tests on page load
        document.addEventListener('DOMContentLoaded', runAllTests);
    </script>
</body>
</html>
`;

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
			},
		});
	}
}