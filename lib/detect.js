// lib/detect.js — Auto-detect Language Server CSRF token and port
// 自動偵測 Language Server 的 CSRF token 和 port

import { execSync } from 'child_process';
import https from 'https';
import os from 'os';

const agent = new https.Agent({ rejectUnauthorized: false });

// ============================================================
//  Platform-specific detection strategies
// ============================================================

function macExtractToken() {
    const ps = execSync('ps aux', { encoding: 'utf-8' });
    const line = ps.split('\n').find(l => l.includes('--csrf_token'));
    if (!line) return null;
    const match = line.match(/--csrf_token\s+(\S+)/);
    return match ? match[1] : null;
}

function macFindPorts() {
    try {
        const output = execSync(
            'lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep language',
            { encoding: 'utf-8' }
        );
        const ports = [];
        for (const line of output.split('\n')) {
            const match = line.match(/:(\d+)\s+\(LISTEN\)/);
            if (match) ports.push(match[1]);
        }
        return [...new Set(ports)];
    } catch {
        return [];
    }
}

function winExtractToken() {
    try {
        const output = execSync(
            'powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'csrf_token\' } | Select-Object -ExpandProperty CommandLine"',
            { encoding: 'utf-8' }
        );
        const match = output.match(/--csrf_token\s+(\S+)/);
        return match ? match[1] : null;
    } catch {
        // Fallback: wmic
        try {
            const output = execSync(
                'wmic process where "commandline like \'%csrf_token%\'" get commandline /format:list',
                { encoding: 'utf-8' }
            );
            const match = output.match(/--csrf_token\s+(\S+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }
}

function winFindPorts() {
    try {
        // Find language_server PID
        const output = execSync(
            'powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'language\' -and $_.CommandLine -match \'csrf_token\' } | Select-Object -ExpandProperty ProcessId"',
            { encoding: 'utf-8' }
        );
        const pid = output.trim();
        if (!pid) return [];

        // Find ports for that PID
        const netstat = execSync(`netstat -ano | findstr ${pid} | findstr LISTENING`, { encoding: 'utf-8' });
        const ports = [];
        for (const line of netstat.split('\n')) {
            const match = line.match(/:(\d+)\s+.*LISTENING/);
            if (match) ports.push(match[1]);
        }
        return [...new Set(ports)];
    } catch {
        return [];
    }
}

const strategies = {
    darwin: { extractToken: macExtractToken, findPorts: macFindPorts },
    linux: { extractToken: macExtractToken, findPorts: macFindPorts },
    win32: { extractToken: winExtractToken, findPorts: winFindPorts },
};

// ============================================================
//  Port verification (cross-platform, no curl needed)
// ============================================================

function verifyPort(port, csrfToken) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ metadata: { ideName: 'antigravity' } });
        const req = https.request({
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs',
            method: 'POST',
            timeout: 3000,
            headers: {
                'Content-Type': 'application/json',
                'x-codeium-csrf-token': csrfToken,
                'connect-protocol-version': '1',
            },
            agent,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data.includes('clientModelConfigs')));
            res.on('error', () => resolve(false));
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.write(body);
        req.end();
    });
}

// ============================================================
//  Main detection function
// ============================================================

export async function detectConnection() {
    const platform = os.platform();
    const strategy = strategies[platform] || strategies.darwin;

    // Step 1: Extract CSRF token
    console.log('  Detecting CSRF token...');
    const csrfToken = strategy.extractToken();
    if (!csrfToken) {
        console.log('  CSRF token not found. Is Antigravity IDE running?');
        return null;
    }
    console.log(`  CSRF: ${csrfToken.substring(0, 8)}...`);

    // Step 2: Find ports
    console.log('  Finding LS ports...');
    const ports = strategy.findPorts();
    if (ports.length === 0) {
        console.log('  No LS ports found.');
        return null;
    }
    console.log(`  Candidates: ${ports.join(', ')}`);

    // Step 3: Verify which port responds to Connect API
    for (const port of ports) {
        const ok = await verifyPort(port, csrfToken);
        if (ok) {
            console.log(`  Verified port: ${port}`);
            return { csrfToken, port };
        }
    }

    // Fallback: use first port
    console.log(`  Using fallback port: ${ports[0]}`);
    return { csrfToken, port: ports[0] };
}
