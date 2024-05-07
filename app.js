const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

const API_KEY = "4y2b9tdg!2024";

const app = express();
const PORT = 3000; // Change to desired port number

const db = new sqlite3.Database('licenses.db');

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS licenses (
        license_key TEXT PRIMARY KEY,
        user_name TEXT,
        valid_until TEXT,
        is_used INTEGER,
        license_type TEXT,
        machine_identifier TEXT,
        is_deleted INTEGER DEFAULT 0
    )`);
}

function verifyLicenseAndUpdate(key, machineIdentifier) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.get("SELECT * FROM licenses WHERE license_key = ?", [key], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (row) {
                    const currentDate = moment();
                    const validUntilDate = moment(row.valid_until);
                    if (currentDate.isBefore(validUntilDate) && (row.is_used === 0 || row.machine_identifier === machineIdentifier)) {
                        db.run("BEGIN TRANSACTION");
                        db.run("UPDATE licenses SET is_used = 1, machine_identifier = ? WHERE license_key = ?", [machineIdentifier, key], (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                reject(err);
                                return;
                            }
                            db.run("COMMIT", (err) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                resolve({
                                    name: row.user_name,
                                    valid_until: row.valid_until,
                                    license_type: row.license_type,
                                    machine_identifier: machineIdentifier
                                });
                            });
                        });
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    });
}

app.use(bodyParser.json());

app.post('/verify_license', async (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { license_key, machine_identifier } = req.body;
    if (license_key && machine_identifier) {
        try {
            const licenseInfo = await verifyLicenseAndUpdate(license_key, machine_identifier);
            if (licenseInfo) {
                res.json({
                    status: "valid",
                    user: licenseInfo.name,
                    valid_until: licenseInfo.valid_until,
                    license_type: licenseInfo.license_type
                });
            } else {
                res.json({ status: "invalid" });
            }
        } catch (err) {
            console.error('Error verifying license:', err);
            res.status(500).json({ error: "Internal server error" });
        }
    } else {
        res.status(400).json({ error: "License key or machine identifier not provided" });
    }
});

app.post('/update_license', (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key, column, value } = req.body;
    if (license_key && column && value) {
        const sql = `UPDATE licenses SET ${column} = ? WHERE license_key = ?`;
        db.run(sql, [value, license_key], function(err) {
            if (err) {
                console.error(`Error updating ${column} for license key ${license_key}:`, err);
                res.status(500).json({ error: "Internal server error" });
            } else {
                if (this.changes > 0) {
                    res.json({ status: "success", message: `${column} updated successfully` });
                } else {
                    res.status(404).json({ error: "License key not found" });
                }
            }
        });
    } else {
        res.status(400).json({ error: "License key, column, or value not provided" });
    }
});

app.post('/add_license', (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key, user_name, valid_until, is_used, license_type, machine_identifier } = req.body;
    if (license_key && user_name && valid_until && typeof is_used === 'number' && license_type && machine_identifier) {
        const sql = `INSERT INTO licenses (license_key, user_name, valid_until, is_used, license_type, machine_identifier) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sql, [license_key, user_name, valid_until, is_used, license_type, machine_identifier], function(err) {
            if (err) {
                console.error('Error adding license:', err);
                res.status(500).json({ error: "Internal server error" });
            } else {
                res.json({ status: "success", message: "License added successfully" });
            }
        });
    } else {
        res.status(400).json({ error: "Incomplete or invalid license information provided" });
    }
});

app.post('/delete_license', (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key } = req.body;
    if (license_key) {
        const sql = `UPDATE licenses SET is_deleted = 1 WHERE license_key = ?`;
        db.run(sql, [license_key], function(err) {
            if (err) {
                console.error('Error deleting license:', err);
                res.status(500).json({ error: "Internal server error" });
            } else {
                if (this.changes > 0) {
                    res.json({ status: "success", message: "License soft deleted successfully" });
                } else {
                    res.status(404).json({ error: "License key not found" });
                }
            }
        });
    } else {
        res.status(400).json({ error: "License key not provided" });
    }
});

initializeDatabase();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
