const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getCurrentVersion() {
    // 1. If this file is inside the al-fca package itself (development mode), use its own package.json
    try {
        const ownPkg = path.join(__dirname, 'package.json');
        if (fs.existsSync(ownPkg)) {
            const pkg = JSON.parse(fs.readFileSync(ownPkg, 'utf-8'));
            if (pkg.name === 'al-fca' && pkg.version) return pkg.version;
        }
    } catch (_) { }

    // 2. Installed as dependency in a user's project
    try {
        const nodeModulesPkg = path.join(process.cwd(), 'node_modules', 'al-fca', 'package.json');
        if (fs.existsSync(nodeModulesPkg)) {
            const pkg = JSON.parse(fs.readFileSync(nodeModulesPkg, 'utf-8'));
            if (pkg.version) return pkg.version;
        }
    } catch (_) { }

    return '1.0.0';
}

async function checkForFCAUpdate() {
    try {
        console.log('\x1b[33m%s\x1b[0m', '🔍 Checking for AL-FCA updates...');

        const { data: npmData } = await axios.get(
            'https://registry.npmjs.org/al-fca/latest'
        );

        const latestVersion = npmData.version;
        const currentVersion = getCurrentVersion();

        if (latestVersion !== currentVersion) {
            const isNewer = compareVersions(latestVersion, currentVersion) > 0;
            if (!isNewer) {
                console.log('\x1b[32m%s\x1b[0m', `✅ AL-FCA is up to date (v${currentVersion})`);
                return false;
            }

            console.log('\x1b[32m%s\x1b[0m', `✨ New AL-FCA version available: ${latestVersion} (current: ${currentVersion})`);
            console.log('\x1b[33m%s\x1b[0m', '📦 Updating AL-FCA package...');

            try {
                const { data: changesData } = await axios.get(
                    'https://raw.githubusercontent.com/alaminnna/al-fca/main/CHANGELOG.md'
                );
                console.log('\x1b[36m%s\x1b[0m', '📋 Recent Changes:');
                const latestChanges = changesData.split('##')[1]?.split('\n').slice(0, 5).join('\n');
                if (latestChanges) console.log(latestChanges);
            } catch (_) { }

            await updateNpmPackage(latestVersion);
            await updateUserPackageJson(latestVersion);

            console.log('\x1b[32m%s\x1b[0m', '✅ AL-FCA updated successfully!');
            console.log('\x1b[33m%s\x1b[0m', '🔄 Restarting to apply changes...');

            setTimeout(() => { process.exit(2); }, 1000);
            return true;
        } else {
            console.log('\x1b[32m%s\x1b[0m', `✅ AL-FCA is up to date (v${currentVersion})`);
            return false;
        }
    } catch (error) {
        console.log('\x1b[31m%s\x1b[0m', '❌ Failed to check for AL-FCA updates:', error.message);
        return false;
    }
}

function compareVersions(a, b) {
    var pa = a.split('.').map(Number);
    var pb = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) {
        var na = pa[i] || 0, nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

async function updateNpmPackage(version) {
    try {
        console.log('\x1b[36m%s\x1b[0m', `📦 Running npm install al-fca@${version}...`);
        execSync(`npm install al-fca@${version} --save`, { cwd: process.cwd(), stdio: 'inherit' });
        console.log('\x1b[32m%s\x1b[0m', '✅ Package installed successfully!');
        return true;
    } catch (error) {
        console.log('\x1b[31m%s\x1b[0m', '❌ Failed to install package:', error.message);
        throw error;
    }
}

async function updateUserPackageJson(version) {
    try {
        const userPackageJsonPath = path.join(process.cwd(), 'package.json');
        if (!fs.existsSync(userPackageJsonPath)) return;
        const packageJson = JSON.parse(fs.readFileSync(userPackageJsonPath, 'utf-8'));
        if (packageJson.dependencies && packageJson.dependencies['al-fca']) {
            packageJson.dependencies['al-fca'] = `^${version}`;
            fs.writeFileSync(userPackageJsonPath, JSON.stringify(packageJson, null, 2));
            console.log('\x1b[32m%s\x1b[0m', `✅ Updated package.json to al-fca@${version}`);
        }
        return true;
    } catch (error) {
        console.log('\x1b[31m%s\x1b[0m', '⚠️  Failed to update user package.json:', error.message);
        return false;
    }
}

module.exports = { checkForFCAUpdate, updateNpmPackage, updateUserPackageJson };
