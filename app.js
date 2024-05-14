const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const winston = require('winston');

const API_KEY = "4y2b9tdg!2024";
const API_KEY_VERIFY = "2024_verify_trnsl8";

const app = express();
const PORT = 3000; // Change to desired port number

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

const db = new sqlite3.Database('licenses.db');

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS licenses (
        license_key TEXT PRIMARY KEY,
        user_name TEXT,
        activation_date TEXT,
        duration_months INTEGER,
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
                    const activationDate = moment(row.activation_date);
                    let expirationDate = activationDate.clone().add(row.duration_months, 'months');
                    if (!activationDate.isValid() && row.is_used === 0) {
                        // fresh license should enter this code block
                        expirationDate = currentDate.clone().add(row.duration_months, 'months');
                        db.run("BEGIN TRANSACTION");
                        db.run("UPDATE licenses SET activation_date = ?, is_used = 1, machine_identifier = ? WHERE license_key = ?", [currentDate.format('YYYY-MM-DD'), machineIdentifier, key], (err) => {
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
                                    valid_until: expirationDate.format('YYYY-MM-DD'),
                                    license_type: row.license_type,
                                    machine_identifier: machineIdentifier
                                });
                            });
                        });
                    } else if (currentDate.isBetween(activationDate, expirationDate, null, '[]') && (row.is_used === 0 || row.machine_identifier === machineIdentifier)) {
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
                                    valid_until: expirationDate.format('YYYY-MM-DD'),
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
    if (apiKey !== API_KEY_VERIFY) {
        logger.warn(`Unauthorized access to /verify_license endpoint with API key: ${apiKey}`);
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
            logger.error('Error verifying license:', err);
            res.status(500).json({ error: "Internal server error" });
        }
    } else {
        res.status(400).json({ error: "License key or machine identifier not provided" });
    }
});

app.post('/update_license', (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        logger.warn(`Unauthorized access to /update_license endpoint with API key: ${apiKey}`);
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key, column, value } = req.body;
    if (license_key && column && value) {
        const sql = `UPDATE licenses SET ${column} = ? WHERE license_key = ?`;
        db.run(sql, [value, license_key], function(err) {
            if (err) {
                logger.error(`Error updating ${column} for license key ${license_key}:`, err);
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
        logger.warn(`Unauthorized access to /add_license endpoint with API key: ${apiKey}`);
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key, user_name, duration_months, is_used, license_type } = req.body;
    if (license_key && user_name && duration_months && typeof is_used === 'number' && license_type) {
        const sql = `INSERT INTO licenses (license_key, user_name, duration_months, is_used, license_type) 
                     VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [license_key, user_name, duration_months, is_used, license_type], function(err) {
            if (err) {
                logger.error('Error adding license:', err);
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
        logger.warn(`Unauthorized access to /delete_license endpoint with API key: ${apiKey}`);
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { license_key } = req.body;
    if (license_key) {
        const sql = `UPDATE licenses SET is_deleted = 1 WHERE license_key = ?`;
        db.run(sql, [license_key], function(err) {
            if (err) {
                logger.error('Error deleting license:', err);
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

app.get('/list_licenses', (req, res) => {
    const apiKey = req.headers['api_key'];
    if (apiKey !== API_KEY) {
        logger.warn(`Unauthorized access to /list_licenses endpoint with API key: ${apiKey}`);
        return res.status(401).json({ error: "Unauthorized" });
    }
    
    const sql = `SELECT * FROM licenses WHERE is_deleted = 0`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            logger.error('Error listing licenses:', err);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json({ licenses: rows });
        }
    });
});

initializeDatabase();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
