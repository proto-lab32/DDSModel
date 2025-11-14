'use client'

import React, { useState } from "react";
import { Upload, Play, BarChart3, TrendingUp, Database, AlertCircle } from "lucide-react";

/**
 * NFL Monte Carlo Simulator - ANCHORED SHRINK CALIBRATION
 * 
 * Core Features:
 * 1. CSV Upload for W11 2024 team database
 * 2. Team selection interface with stat preview
 * 3. Monte Carlo simulation (10k+ iterations)
 * 4. Correlated random variables (adaptive ρ)
 * 
 * Scoring Model:
 * - Anchored shrink formula: PPD_adj = league_avg + λ(PPD_raw - league_avg)
 * - Lambda (λ) = 0.88 (preserves base scoring, softens extremes)
 * - PPD clamping (0.8 to 3.2) for stability
 * - League averages: PPD = 2.128, PPD_def = 2.123
 * 
 * Weather System (Empirically Calibrated):
 * - Dome Game: +1.5 points total
 * - Wind: -0.07 per MPH (15 MPH = -1.1 pts)
 * - Heavy Rain: -1.8 points (stacks with wind)
 * - 20 MPH + Heavy Rain: -3.2 points total
 * - Perfect conditions (<5 MPH): ~0 points
 * 
 * Betting Analysis:
 * - Game totals over/under
 * - Point spread with alt-lines table
 * - Fair odds (American format)
 * - Expected value at -110 juice
 * - Kelly criterion bet sizing
 * - Moneyline win probabilities
 */

const NFLTotalsSimulator = () => {
  // State management
  const [teams, setTeams] = useState([]);
  const [selectedHomeTeam, setSelectedHomeTeam] = useState(null);
  const [selectedAwayTeam, setSelectedAwayTeam] = useState(null);
  const [csvUploaded, setCsvUploaded] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [gameSettings, setGameSettings] = useState({
    overUnderLine: 44.5,
    homeTeamTotal: 23.5,
    awayTeamTotal: 21.0,
    spread: -3.0,
    spreadLine: -3.0, // Line to bet against
    numSimulations: 10000,
    isDome: false,
    windMPH: 0,
    temperature: 70,
    precipitation: "none"
  });
  const [simulationResults, setSimulationResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // League baseline parameters (W11 2024 database averages)
  const params = {
    lg: {
      // Offensive averages (from W11 database)
      PPD: 2.24,           // Increased to match 2024 NFL scoring environment
      PPD_sd: 0.42,
      EPA: 0.022651,
      EPA_sd: 0.127,
      SR: 0.4470,
      SR_sd: 0.05,
      Xpl: 0.0975,
      Xpl_sd: 0.033,
      RZ: 0.5922,
      RZ_sd: 0.12,
      ThreeOut: 0.2174,
      ThreeOut_sd: 0.05,
      Pen: 0.330629,
      Pen_sd: 0.12,
      Drives: 10.18021,
      
      // Defensive averages (from W11 database)
      PPD_def: 2.24,       // Updated to match offensive average
      PPD_def_sd: 0.42,
      EPA_def: 0.022565,
      SR_def: 0.4449,
      Xpl_def: 0.0973,
      RZ_def: 0.5838,
      ThreeOut_def: 0.2149,
      Pen_def: 0.254817,
      Drives_def: 10.18331,
      
      // Pace factors
      SecSnap: 27.22985,
      SecSnap_sd: 2.0,
      PassRate: 0.5404,
      PassRate_sd: 0.08,
      NoHuddle: 0.1053,
      NoHuddle_sd: 0.10,
      PlaysPerDrive: 6.188675,
      
      // Other
      TO_pct_league: 0.12,
      TO_pct_sd: 0.04,
      TO_points: 2.4,
      StartingFP: 30.10622,
      StartingFP_sd: 3.0,
    },
    LAMBDA_BASE: 0.95, // Increased from 0.88 - less shrink preserves more edge
    LAMBDA_HIGH_TOTAL: 0.96, // For high-scoring games (46+)
    LAMBDA_LOW_TOTAL: 0.92, // For low-scoring games (41-)
    HOME_FIELD_ADVANTAGE: 0.20, // +0.20 PPD for home team (~2.0 points)
    NOISE_REDUCTION: 2.6, // Base noise level
    
    // ===== WEATHER COEFFICIENTS =====
    weather: {
      dome_bonus: 2.5,      // Increased dome advantage
      wind_per_mph_above_threshold: -0.035,  // Gentler slope
      wind_threshold: 12,    // No penalty under 12 MPH (market treats as noise)
      wind_variance_per_mph: 0.01,
      extreme_cold_threshold: 20,
      extreme_cold_penalty: -1.0,
      precip_adjustments: {
        none: 0,
        light_rain: -0.8,    // Light rain drag
        heavy_rain: -1.0,    // Heavy rain drag (reduced)
        snow: -1.5,          // Snow drag (reduced)
      },
    },
  };

  const RHO_BASELINE = 0.20;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /**
   * Convert probability to American odds for display
   */
  const toAmericanOdds = (prob) => {
    if (prob <= 0) return Infinity;
    if (prob >= 1) return -Infinity;
    return prob >= 0.5 
      ? -Math.round((prob / (1 - prob)) * 100)
      : Math.round(((1 - prob) / prob) * 100);
  };

  /**
   * Calculate adaptive correlation (ρ) based on game context
   */
  function calculateAdaptiveCorrelation(homeTeam, awayTeam, spread, isDome, windMPH, precip) {
    let rho = RHO_BASELINE;
    
    // Helper to find column value
    const findValue = (team, possibleNames) => {
      for (let name of possibleNames) {
        if (team[name] !== undefined && team[name] !== '') {
          return team[name];
        }
      }
      return null;
    };
    
    // 1. Competitiveness factor
    const absSpread = Math.abs(spread);
    if (absSpread <= 3) rho += 0.10;
    else if (absSpread <= 7) rho += 0.05;
    else if (absSpread >= 14) rho -= 0.10;
    
    // 2. Style alignment
    const homePassRate = parseFloat(findValue(homeTeam, ['Offensive Early Down Pass Rate', 'Offensive Pass rate', 'PassRate', 'Pass rate'])) || params.lg.PassRate;
    const awayPassRate = parseFloat(findValue(awayTeam, ['Offensive Early Down Pass Rate', 'Offensive Pass rate', 'PassRate', 'Pass rate'])) || params.lg.PassRate;
    const passRateDiff = Math.abs(homePassRate - awayPassRate);
    if (passRateDiff < 0.05) rho += 0.08;
    else if (passRateDiff > 0.15) rho -= 0.05;
    
    const homeXpl = parseFloat(findValue(homeTeam, ['Offensive Explosive Play Rate', 'Offensive Explosive rate', 'Xpl_rate', 'Explosive rate'])) || params.lg.Xpl;
    const awayXpl = parseFloat(findValue(awayTeam, ['Offensive Explosive Play Rate', 'Offensive Explosive rate', 'Xpl_rate', 'Explosive rate'])) || params.lg.Xpl;
    const xplSum = homeXpl + awayXpl;
    if (xplSum > 0.20) rho += 0.05;
    
    // 3. Environmental factors
    if (isDome) rho += 0.05;
    if (windMPH > 15) rho -= 0.15;
    else if (windMPH > 10) rho -= 0.08;
    
    if (precip === "heavy_rain" || precip === "snow") rho -= 0.10;
    else if (precip === "light_rain") rho -= 0.05;
    
    // 4. Pace coupling
    const homeSecSnap = parseFloat(findValue(homeTeam, ['Offensive Seconds/Snap', 'Offensive Sec/snap', 'SecSnap', 'Sec/snap'])) || params.lg.SecSnap;
    const awaySecSnap = parseFloat(findValue(awayTeam, ['Offensive Seconds/Snap', 'Offensive Sec/snap', 'SecSnap', 'Sec/snap'])) || params.lg.SecSnap;
    const avgPace = (homeSecSnap + awaySecSnap) / 2;
    if (avgPace < 26) rho += 0.05;
    else if (avgPace > 29) rho -= 0.03;
    
    return clamp(rho, -0.05, 0.60);
  }

  /**
   * Robust percent parsing - handles "44.7", "0.447", or "44.7%"
   */
  function parsePercent(val) {
    if (val == null || val === "") return null;
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    if (num > 1) return num / 100;
    return num;
  }

  /**
   * Parse CSV file and extract team data
   * Handles column names with spaces and maps them to our internal structure
   */
  function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error("CSV file appears to be empty or invalid");
    }

    // Parse headers - handle both comma and potentially quoted fields
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);
    const teamData = [];

    console.log("CSV Headers found:", headers);

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < headers.length - 5) continue; // Allow some flexibility

      const team = {};
      headers.forEach((header, index) => {
        if (index < values.length) {
          team[header] = values[index];
        }
      });

      // Validate required fields - just need team name
      if (team.team || team.Team) {
        // Normalize team name to uppercase "Team" for consistency
        team.Team = team.team || team.Team;
        teamData.push(team);
      }
    }

    if (teamData.length === 0) {
      throw new Error("No valid team data found. Please check CSV format.");
    }

    return teamData;
  }

  /**
   * Parse a CSV line handling quoted fields
   */
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Get display value for a team stat - tries multiple column name variations
   */
  const getDisplayValue = (team, possibleNames) => {
    for (let name of possibleNames) {
      const value = team[name];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return 'N/A';
  };

  /**
   * Handle CSV file upload
   */
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadError(null);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        const parsedTeams = parseCSV(csvText);
        
        if (parsedTeams.length === 0) {
          throw new Error("No valid team data found in CSV");
        }

        setTeams(parsedTeams);
        setCsvUploaded(true);
        
        // Debug: Show first team's columns
        console.log(`Successfully loaded ${parsedTeams.length} teams`);
        console.log("Sample team data (first team):", parsedTeams[0]);
        console.log("Available columns:", Object.keys(parsedTeams[0]));
      } catch (error) {
        setUploadError(error.message);
        console.error("CSV parsing error:", error);
      }
    };

    reader.onerror = () => {
      setUploadError("Failed to read file");
    };

    reader.readAsText(file);
  };

  /**
   * Run Monte Carlo simulation
   */
  const runSimulation = () => {
    if (!selectedHomeTeam || !selectedAwayTeam) {
      alert("Please select both home and away teams");
      return;
    }

    setIsSimulating(true);
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const results = simulateGame(
          selectedHomeTeam,
          selectedAwayTeam,
          gameSettings
        );
        setSimulationResults(results);
      } catch (error) {
        alert(`Simulation error: ${error.message}`);
        console.error(error);
      } finally {
        setIsSimulating(false);
      }
    }, 100);
  };

  /**
   * Main simulation function
   */
  function simulateGame(homeTeam, awayTeam, settings) {
    const numSims = settings.numSimulations;
    const results = {
      homeScores: [],
      awayScores: [],
      totals: [],
      margins: [], // Home team margin (positive = home wins)
      correlationUsed: 0,
      weatherAdjustment: 0
    };

    // Calculate correlation
    const rho = calculateAdaptiveCorrelation(
      homeTeam,
      awayTeam,
      settings.spread,
      settings.isDome,
      settings.windMPH,
      settings.precipitation
    );
    results.correlationUsed = rho;

    // Calculate weather adjustment
    let weatherAdj = 0;
    if (settings.isDome) {
      weatherAdj += params.weather.dome_bonus;
    } else {
      // Outdoor conditions - apply wind effect
      if (settings.windMPH > params.weather.wind_threshold) {
        const windImpact = settings.windMPH * params.weather.wind_per_mph_above_threshold;
        weatherAdj += windImpact;
      }
      
      // Temperature effect
      if (settings.temperature < params.weather.extreme_cold_threshold) {
        weatherAdj += params.weather.extreme_cold_penalty;
      }
      
      // Precipitation effect (stacks with wind)
      weatherAdj += params.weather.precip_adjustments[settings.precipitation] || 0;
    }
    results.weatherAdjustment = weatherAdj;

    // Get team stats
    const homeOffense = getTeamOffensiveStats(homeTeam);
    const homeDefense = getTeamDefensiveStats(homeTeam);
    const awayOffense = getTeamOffensiveStats(awayTeam);
    const awayDefense = getTeamDefensiveStats(awayTeam);

    // Debug logging
    console.log("=== Team Stats Debug ===");
    console.log("Home Team:", homeTeam.Team);
    console.log("Home Offense PPD:", homeOffense.ppd, "(League avg:", params.lg.PPD, ")");
    console.log("Home Defense PPD allowed:", homeDefense.ppd_allowed, "(League avg:", params.lg.PPD_def, ")");
    console.log("Away Team:", awayTeam.Team);
    console.log("Away Offense PPD:", awayOffense.ppd, "(League avg:", params.lg.PPD, ")");
    console.log("Away Defense PPD allowed:", awayDefense.ppd_allowed, "(League avg:", params.lg.PPD_def, ")");
    
    // Sanity check
    if (homeOffense.ppd === awayOffense.ppd && homeDefense.ppd_allowed === awayDefense.ppd_allowed) {
      console.warn("⚠️ WARNING: Both teams have identical stats! Check CSV data or column mapping.");
    }
    
    // === ANCHORED SHRINK FORMULA WITH CONTEXTUAL LAMBDA ===
    // Calculate raw matchup PPD, then apply contextual lambda based on expected total
    // Higher totals (elite offenses) → higher lambda (preserve more edge)
    // Lower totals (defensive games) → lower lambda (more regression)
    
    const PPD_FLOOR = 1.35; // Realistic minimum (~13.7 points)
    const HOME_ADVANTAGE = params.HOME_FIELD_ADVANTAGE; // +0.15 PPD (~1.5 points)
    
    // Home team raw PPD (full matchup effect + home field advantage)
    let homeRawPPD = homeOffense.ppd + (awayDefense.ppd_allowed - params.lg.PPD_def) + HOME_ADVANTAGE;
    homeRawPPD = Math.max(PPD_FLOOR, homeRawPPD); // Apply floor
    
    // Away team raw PPD (full matchup effect, no home advantage)
    let awayRawPPD = awayOffense.ppd + (homeDefense.ppd_allowed - params.lg.PPD_def);
    awayRawPPD = Math.max(PPD_FLOOR, awayRawPPD); // Apply floor
    
    // Calculate raw total to determine contextual lambda
    const rawTotal = (homeRawPPD + awayRawPPD) * params.lg.Drives;
    
    // Contextual lambda: preserve more signal in high-scoring games
    let LAMBDA;
    if (rawTotal >= 46) {
      LAMBDA = params.LAMBDA_HIGH_TOTAL; // 0.92 - keep edges in high-scoring games
    } else if (rawTotal <= 41) {
      LAMBDA = params.LAMBDA_LOW_TOTAL; // 0.86 - more regression in low-scoring games
    } else {
      LAMBDA = params.LAMBDA_BASE; // 0.88 - baseline
    }
    
    // Apply anchored shrink: shrink the DEVIATION from league mean
    const homeExpectedPPD = params.lg.PPD + LAMBDA * (homeRawPPD - params.lg.PPD);
    const awayExpectedPPD = params.lg.PPD + LAMBDA * (awayRawPPD - params.lg.PPD);
    
    console.log("\n=== PPD Calculations (contextual lambda) ===");
    console.log("Raw total:", rawTotal.toFixed(1), "→ Lambda:", LAMBDA.toFixed(3));
    console.log("Home raw PPD (before floor):", (homeOffense.ppd + (awayDefense.ppd_allowed - params.lg.PPD_def) + HOME_ADVANTAGE).toFixed(3), "(includes +" + HOME_ADVANTAGE.toFixed(2) + " home advantage)");
    console.log("Home raw PPD (after floor):", homeRawPPD.toFixed(3));
    console.log("Home deviation from league:", (homeRawPPD - params.lg.PPD).toFixed(3));
    console.log("Home adjusted PPD:", homeExpectedPPD.toFixed(3), "= league_avg", params.lg.PPD.toFixed(3), "+", LAMBDA, "×", (homeRawPPD - params.lg.PPD).toFixed(3));
    console.log("Home Expected score (10.18 drives):", (homeExpectedPPD * params.lg.Drives).toFixed(1));
    console.log("");
    console.log("Away raw PPD (before floor):", (awayOffense.ppd + (homeDefense.ppd_allowed - params.lg.PPD_def)).toFixed(3), "(no home advantage)");
    console.log("Away raw PPD (after floor):", awayRawPPD.toFixed(3));
    console.log("Away deviation from league:", (awayRawPPD - params.lg.PPD).toFixed(3));
    console.log("Away adjusted PPD:", awayExpectedPPD.toFixed(3), "= league_avg", params.lg.PPD.toFixed(3), "+", LAMBDA, "×", (awayRawPPD - params.lg.PPD).toFixed(3));
    console.log("Away Expected score (10.18 drives):", (awayExpectedPPD * params.lg.Drives).toFixed(1));
    console.log("Total expected:", ((homeExpectedPPD + awayExpectedPPD) * params.lg.Drives).toFixed(1));
    console.log("PPD Floor: " + PPD_FLOOR + " | Home Advantage: +" + HOME_ADVANTAGE.toFixed(2) + " PPD");
    console.log("========================");

    // Run simulations
    console.log("=== Starting Simulation Loop ===");
    console.log("Running", numSims, "simulations");
    console.log("Weather adjustment:", weatherAdj.toFixed(2), "points per team");
    console.log("Correlation:", rho.toFixed(3));
    
    for (let i = 0; i < numSims; i++) {
      // Generate correlated random values
      const z1 = randn();
      const z2 = randn();
      const homeRandom = z1;
      const awayRandom = rho * z1 + Math.sqrt(1 - rho * rho) * z2;

      // Calculate team PPD - USE ANCHORED SHRINK
      const homeNetPPD = homeExpectedPPD;
      const awayNetPPD = awayExpectedPPD;

      // Debug first simulation only
      if (i === 0) {
        console.log("\n=== First Simulation Details ===");
        console.log("Home Net PPD:", homeNetPPD.toFixed(3));
        console.log("Away Net PPD:", awayNetPPD.toFixed(3));
        console.log("");
        console.log("Random values - Home:", homeRandom.toFixed(3), "Away:", awayRandom.toFixed(3));
      }

      // Add randomness with reduced noise (2.6x instead of raw calculation ~3.2x)
      // This matches observed IQR of NFL team points after shrinkage
      const baseSD = Math.sqrt(
        Math.pow(params.lg.PPD_sd, 2) + 
        Math.pow(params.lg.PPD_def_sd, 2)
      );
      const noiseReduction = params.NOISE_REDUCTION / 3.2; // Scale from 3.2 to 2.6
      const homeSD = baseSD * noiseReduction;
      const awaySD = homeSD; // Same variance structure

      // Drive estimation - use league average
      const homeDrives = params.lg.Drives;
      const awayDrives = params.lg.Drives;

      // Expected scores before randomness
      const expHome = homeNetPPD * homeDrives;
      const expAway = awayNetPPD * awayDrives;

      // Heteroskedastic noise: scale with expected score
      // Returns sigma in POINTS (not PPD) - typical range 7-10 points
      const sigmaTeam = (m) => Math.max(7.0, Math.min(10.0, 6.0 + 0.15 * (m - 21)));

      // Calculate scores with heteroskedastic noise
      let homeScore = Math.max(0, expHome + homeRandom * sigmaTeam(expHome));
      let awayScore = Math.max(0, expAway + awayRandom * sigmaTeam(expAway));
      
      // Apply weather adjustment to TOTAL scoring (split between teams)
      const totalWeatherImpact = weatherAdj;
      homeScore = Math.max(0, homeScore + (totalWeatherImpact * 0.5));
      awayScore = Math.max(0, awayScore + (totalWeatherImpact * 0.5));

      if (i === 0) {
        console.log("Heteroskedastic sigma - Home:", sigmaTeam(expHome).toFixed(2), "Away:", sigmaTeam(expAway).toFixed(2));
        console.log("Drives - Home:", homeDrives.toFixed(1), "Away:", awayDrives.toFixed(1));
        console.log("Expected scores - Home:", expHome.toFixed(1), "Away:", expAway.toFixed(1));
        console.log("Weather adjustment per team:", (totalWeatherImpact * 0.5).toFixed(2));
        console.log("Home final score:", homeScore.toFixed(1));
        console.log("Away final score:", awayScore.toFixed(1));
        console.log("Total:", (homeScore + awayScore).toFixed(1));
        console.log("================================\n");
      }

      const homeScoreRounded = Math.round(homeScore);
      const awayScoreRounded = Math.round(awayScore);
      
      results.homeScores.push(homeScoreRounded);
      results.awayScores.push(awayScoreRounded);
      results.totals.push(homeScoreRounded + awayScoreRounded);
      results.margins.push(homeScoreRounded - awayScoreRounded);
    }
    
    console.log("=== Simulation Complete ===");
    console.log("Sample of first 10 home scores:", results.homeScores.slice(0, 10));
    console.log("Sample of first 10 away scores:", results.awayScores.slice(0, 10));
    console.log("Sample of first 10 margins:", results.margins.slice(0, 10));

    // Calculate statistics
    return calculateResults(results, settings, homeTeam.Team, awayTeam.Team);
  }

  /**
   * Extract offensive stats from team data
   * Handles various column naming conventions
   */
  function getTeamOffensiveStats(team) {
    // Helper to find column value by multiple possible names
    const findValue = (possibleNames) => {
      for (let name of possibleNames) {
        if (team[name] !== undefined && team[name] !== '') {
          return team[name];
        }
      }
      return null;
    };

    const ppd = parseFloat(findValue(['Offensive Pts/Drive', 'Offensive PPD', 'PPD', 'Off PPD', 'ppd'])) || params.lg.PPD;
    const epa = parseFloat(findValue(['Offensive EPA/Play', 'Offensive EPA/play', 'EPA_play', 'EPA/play', 'Off EPA'])) || params.lg.EPA;
    const sr = parsePercent(findValue(['Offensive Success Rate', 'Offensive Success rate', 'Success_rate', 'Success rate', 'SR'])) || params.lg.SR;
    const xpl = parsePercent(findValue(['Offensive Explosive Play Rate', 'Offensive Explosive rate', 'Xpl_rate', 'Explosive rate', 'Xpl'])) || params.lg.Xpl;
    const rz = parsePercent(findValue(['Offensive Red Zone TD Rate', 'Offensive RZ TD%', 'RZ_TD_pct', 'RZ TD%', 'RZ'])) || params.lg.RZ;

    // Debug: log what we found
    console.log(`${team.team || team.Team} Offense - PPD: ${ppd}, EPA: ${epa}, SR: ${sr}`);

    return { ppd, epa, sr, xpl, rz };
  }

  /**
   * Extract defensive stats from team data
   * Handles various column naming conventions
   */
  function getTeamDefensiveStats(team) {
    // Helper to find column value by multiple possible names
    const findValue = (possibleNames) => {
      for (let name of possibleNames) {
        if (team[name] !== undefined && team[name] !== '') {
          return team[name];
        }
      }
      return null;
    };

    const ppd_allowed = parseFloat(findValue(['Defensive Pts/Drive', 'Defensive PPD allowed', 'PPD_allowed', 'PPD allowed', 'Def PPD'])) || params.lg.PPD_def;
    const epa_allowed = parseFloat(findValue(['Defensive EPA/Play', 'Defensive EPA allowed', 'EPA_allowed', 'EPA allowed', 'Def EPA'])) || params.lg.EPA_def;
    const sr_allowed = parsePercent(findValue(['Defensive Success Rate', 'Defensive Success rate allowed', 'SR_allowed', 'Success rate allowed', 'Def SR'])) || params.lg.SR_def;

    // Debug: log what we found
    console.log(`${team.team || team.Team} Defense - PPD allowed: ${ppd_allowed}, EPA: ${epa_allowed}, SR: ${sr_allowed}`);

    return { ppd_allowed, epa_allowed, sr_allowed };
  }

  /**
   * Generate standard normal random variable (Box-Muller)
   */
  function randn() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Calculate percentile
   */
  function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Calculate results from simulation data
   */
  function calculateResults(results, settings, homeTeamName, awayTeamName) {
    const homeScores = results.homeScores;
    const awayScores = results.awayScores;
    const totals = results.totals;
    const margins = results.margins;
    const n = settings.numSimulations;

    // Over/Under analysis
    let overCount = 0;
    let underCount = 0;
    let pushCount = 0;
    
    totals.forEach(total => {
      if (total > settings.overUnderLine) overCount++;
      else if (total < settings.overUnderLine) underCount++;
      else pushCount++;
    });

    // Home team total
    let homeOverCount = 0;
    let homeUnderCount = 0;
    let homePushCount = 0;
    
    homeScores.forEach(score => {
      if (score > settings.homeTeamTotal) homeOverCount++;
      else if (score < settings.homeTeamTotal) homeUnderCount++;
      else homePushCount++;
    });

    // Away team total
    let awayOverCount = 0;
    let awayUnderCount = 0;
    let awayPushCount = 0;
    
    awayScores.forEach(score => {
      if (score > settings.awayTeamTotal) awayOverCount++;
      else if (score < settings.awayTeamTotal) awayUnderCount++;
      else awayPushCount++;
    });

    // MONEYLINE ANALYSIS
    let homeWinCount = 0;
    let awayWinCount = 0;
    
    margins.forEach(margin => {
      if (margin > 0) homeWinCount++;
      else if (margin < 0) awayWinCount++;
    });

    const homeMLProb = homeWinCount / n;
    const awayMLProb = awayWinCount / n;

    // SPREAD ANALYSIS with Alt-Lines
    const spreadLine = settings.spreadLine;
    
    // Main spread line analysis
    let homeCoverCount = 0;
    let awayCoverCount = 0;
    let spreadPushCount = 0;
    
    margins.forEach(margin => {
      const threshold = -spreadLine;
      
      if (margin > threshold) {
        homeCoverCount++;
      } else if (margin < threshold) {
        awayCoverCount++;
      } else {
        spreadPushCount++;
      }
    });

    const coverProb = homeCoverCount / n;

    // Alt-lines analysis
    const altLines = [-14, -10.5, -7, -6.5, -3.5, -3, -2.5, -1.5, 0, +1.5, +2.5, +3, +3.5, +6.5, +7, +10.5, +14];
    const altLinesAnalysis = altLines.map(line => {
      let coverCount = 0;
      margins.forEach(margin => {
        if (margin > -line) coverCount++;
      });
      const prob = coverCount / n;
      return {
        line: line,
        coverPct: prob * 100,
      };
    });

    return {
      numSimulations: settings.numSimulations,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      correlationUsed: results.correlationUsed,
      weatherAdjustment: results.weatherAdjustment,
      
      overUnder: {
        line: settings.overUnderLine,
        overPct: (overCount / n) * 100,
        underPct: (underCount / n) * 100,
        pushPct: (pushCount / n) * 100,
      },
      
      homeTeamOverUnder: {
        line: settings.homeTeamTotal,
        overPct: (homeOverCount / n) * 100,
        underPct: (homeUnderCount / n) * 100,
        pushPct: (homePushCount / n) * 100,
      },
      
      awayTeamOverUnder: {
        line: settings.awayTeamTotal,
        overPct: (awayOverCount / n) * 100,
        underPct: (awayUnderCount / n) * 100,
        pushPct: (awayPushCount / n) * 100,
      },
      
      // Moneyline
      moneyline: {
        homeWinPct: homeMLProb * 100,
        awayWinPct: awayMLProb * 100,
        homeFairOdds: toAmericanOdds(homeMLProb),
        awayFairOdds: toAmericanOdds(awayMLProb),
      },
      
      // Spread analysis
      spread: {
        line: spreadLine,
        homeCoverPct: (homeCoverCount / n) * 100,
        awayCoverPct: (awayCoverCount / n) * 100,
        pushPct: (spreadPushCount / n) * 100,
        altLines: altLinesAnalysis,
      },
      
      homeProjection: {
        mean: homeScores.reduce((a, b) => a + b, 0) / homeScores.length,
        median: percentile(homeScores, 50),
        p10: percentile(homeScores, 10),
        p90: percentile(homeScores, 90),
      },
      
      awayProjection: {
        mean: awayScores.reduce((a, b) => a + b, 0) / awayScores.length,
        median: percentile(awayScores, 50),
        p10: percentile(awayScores, 10),
        p90: percentile(awayScores, 90),
      },
      
      totalProjection: {
        mean: totals.reduce((a, b) => a + b, 0) / totals.length,
        median: percentile(totals, 50),
        p10: percentile(totals, 10),
        p90: percentile(totals, 90),
      },
      
      // Margin projections
      marginProjection: {
        mean: margins.reduce((a, b) => a + b, 0) / margins.length,
        median: percentile(margins, 50),
        p10: percentile(margins, 10),
        p90: percentile(margins, 90),
      },
    };
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header - Gamble-Tron Style */}
        <div className="text-center py-8 mb-8">
          <div className="inline-block bg-gradient-to-b from-gray-300 to-gray-400 p-6 rounded-lg border-4 border-gray-500 shadow-2xl mb-4">
            <h1 className="text-6xl font-bold mb-1 text-black tracking-wider" style={{ 
              fontFamily: 'Impact, "Arial Black", sans-serif',
              textShadow: '3px 3px 0px rgba(0,0,0,0.3)',
              letterSpacing: '0.1em'
            }}>
              GAMBLE-TRON
            </h1>
            <div className="text-5xl font-bold text-black tracking-widest" style={{ 
              fontFamily: 'Impact, "Arial Black", sans-serif',
              letterSpacing: '0.3em'
            }}>
              2025
            </div>
          </div>
          
          {/* Spinning Reels */}
          <div className="flex justify-center gap-64 mt-6 mb-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-gray-800 bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center animate-spin shadow-lg" style={{ animationDuration: '3s' }}>
                <div className="w-4 h-4 bg-gray-900 rounded-full"></div>
                <div className="absolute w-1 h-12 bg-gray-800 top-2" style={{ transform: 'rotate(45deg)' }}></div>
                <div className="absolute w-1 h-12 bg-gray-800 top-2" style={{ transform: 'rotate(-45deg)' }}></div>
              </div>
            </div>
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-gray-800 bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center animate-spin shadow-lg" style={{ animationDuration: '3s', animationDirection: 'reverse' }}>
                <div className="w-4 h-4 bg-gray-900 rounded-full"></div>
                <div className="absolute w-1 h-12 bg-gray-800 top-2" style={{ transform: 'rotate(45deg)' }}></div>
                <div className="absolute w-1 h-12 bg-gray-800 top-2" style={{ transform: 'rotate(-45deg)' }}></div>
              </div>
            </div>
          </div>
          
          {/* Control Panel Lights */}
          <div className="flex justify-center gap-2 mb-2">
            <div className="w-4 h-4 rounded-full bg-orange-500 animate-pulse" style={{ animationDuration: '1s' }}></div>
            <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse" style={{ animationDuration: '1.5s' }}></div>
            <div className="w-4 h-4 rounded-full bg-white animate-pulse" style={{ animationDuration: '2s' }}></div>
            <div className="w-4 h-4 rounded-full bg-pink-300 animate-pulse" style={{ animationDuration: '1.2s' }}></div>
            <div className="w-4 h-4 rounded-full bg-white animate-pulse" style={{ animationDuration: '1.8s' }}></div>
            <div className="w-4 h-4 rounded-full bg-orange-500 animate-pulse" style={{ animationDuration: '1.4s' }}></div>
            <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse" style={{ animationDuration: '2.2s' }}></div>
          </div>
          
          <p className="text-yellow-300 text-lg font-semibold mb-2">
            🏈 Advanced Monte Carlo Simulation System 🎰
          </p>
          <div className="flex justify-center gap-3 text-xs text-slate-300">
            <span className="bg-red-600/30 px-3 py-1 rounded-full border border-red-500">● ACTIVE</span>
            <span className="bg-yellow-600/30 px-3 py-1 rounded-full border border-yellow-500">● CALCULATING</span>
            <span className="bg-green-600/30 px-3 py-1 rounded-full border border-green-500">● READY</span>
          </div>
        </div>

        {/* CSV Upload Section */}
        {!csvUploaded && (
          <div className="bg-gradient-to-b from-gray-400 to-gray-500 p-8 mb-8 border-4 border-gray-600 shadow-2xl rounded-lg">
            <div className="flex items-center gap-3 mb-6">
              <Database className="w-8 h-8 text-orange-600" />
              <h2 className="text-2xl font-bold text-black">STEP 1: UPLOAD TEAM DATABASE</h2>
            </div>
            
            <div className="bg-slate-900/70 rounded-lg p-6 mb-6 border-2 border-yellow-600">
              <p className="text-yellow-200 mb-4 font-semibold">
                Upload a CSV file containing your NFL team statistics. The app will automatically detect column names with spaces.
              </p>
              <div className="text-sm text-yellow-200 mb-2">
                <strong className="text-yellow-100">EXPECTED COLUMNS (WITH VARIATIONS SUPPORTED):</strong>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-yellow-200 mb-4 font-semibold">
                <div>• team / Team</div>
                <div>• Offensive PPD</div>
                <div>• Defensive PPD allowed</div>
                <div>• Offensive EPA/play</div>
                <div>• Defensive EPA allowed</div>
                <div>• Offensive Success rate</div>
                <div>• Defensive Success rate allowed</div>
                <div>• Offensive Explosive rate</div>
                <div>• Offensive RZ TD%</div>
                <div>• Offensive Pass rate</div>
                <div>• Offensive Sec/snap</div>
              </div>
              <p className="text-xs text-yellow-300 font-semibold">
                NOTE: The app will attempt to match variations of these column names (e.g., "PPD", "Off PPD", "Offensive PPD")
              </p>
            </div>

            <label className="flex flex-col items-center justify-center w-full h-64 border-4 border-dashed border-orange-600 rounded-lg cursor-pointer bg-slate-800 hover:bg-slate-700 transition-all shadow-xl">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-16 h-16 mb-4 text-orange-400" />
                <p className="mb-2 text-lg font-semibold text-yellow-300">
                  CLICK TO UPLOAD CSV FILE
                </p>
                <p className="text-sm text-yellow-200">
                  CSV FILES ONLY
                </p>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".csv"
                onChange={handleFileUpload}
              />
            </label>

            {uploadError && (
              <div className="mt-4 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-300">Upload Error</p>
                  <p className="text-sm text-red-200">{uploadError}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Interface - Only show after CSV upload */}
        {csvUploaded && (
          <>
            {/* Column Debug Info */}
            {teams.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-6 mb-6 border border-blue-600/30">
                <h3 className="text-lg font-bold mb-3 text-blue-400">📊 CSV Loaded Successfully</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Teams loaded:</span>
                    <span className="ml-2 text-green-400 font-semibold">{teams.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Columns found:</span>
                    <span className="ml-2 text-green-400 font-semibold">
                      {teams[0] ? Object.keys(teams[0]).length : 0}
                    </span>
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                    Show all column names (click to expand)
                  </summary>
                  <div className="mt-2 p-3 bg-slate-900/50 rounded text-xs text-slate-400 max-h-40 overflow-y-auto">
                    {teams[0] && Object.keys(teams[0]).map((col, i) => (
                      <div key={i} className="py-0.5">• {col}</div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {/* Team Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* Home Team */}
              <div className="bg-slate-800 rounded-xl p-6 border border-orange-600/50 shadow-2xl">
                <h3 className="text-xl font-bold mb-4 text-orange-400 flex items-center gap-2">
                  <span className="text-2xl">🏠</span> Home Team
                </h3>
                <select
                  className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-orange-400 focus:outline-none"
                  value={selectedHomeTeam?.Team || ""}
                  onChange={(e) => {
                    const team = teams.find(t => t.Team === e.target.value);
                    setSelectedHomeTeam(team);
                    console.log("HOME TEAM SELECTED:", team);
                    console.log("Home team columns:", Object.keys(team));
                  }}
                >
                  <option value="">Select Home Team</option>
                  {teams.map((team) => (
                    <option key={team.Team} value={team.Team}>
                      {team.Team}
                    </option>
                  ))}
                </select>
                
                {selectedHomeTeam && (
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">PPD:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, [
                          'Offensive Pts/Drive',
                          'Offensive PPD',
                          'PPD',
                          'Off PPD',
                          'ppd',
                          'offensive_ppd'
                        ])}
                      </div>
                      <div className="text-slate-400">EPA/play:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, [
                          'Offensive EPA/Play',
                          'Offensive EPA/play',
                          'EPA/play',
                          'EPA_play',
                          'Off EPA',
                          'offensive_epa'
                        ])}
                      </div>
                      <div className="text-slate-400">Success Rate:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, [
                          'Offensive Success Rate',
                          'Offensive Success rate',
                          'Success_rate',
                          'Success rate',
                          'SR',
                          'offensive_sr'
                        ])}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        console.log("=== HOME TEAM FULL DATA ===");
                        console.log(selectedHomeTeam);
                        console.log("All columns:", Object.keys(selectedHomeTeam));
                        console.log("Sample values:");
                        Object.keys(selectedHomeTeam).slice(0, 10).forEach(key => {
                          console.log(`  ${key}: ${selectedHomeTeam[key]}`);
                        });
                      }}
                      className="mt-2 text-xs text-slate-500 hover:text-slate-400 underline"
                    >
                      Debug: Log full team data to console
                    </button>
                  </div>
                )}
              </div>

              {/* Away Team */}
              <div className="bg-slate-800 rounded-xl p-6 border border-purple-600/50 shadow-2xl">
                <h3 className="text-xl font-bold mb-4 text-purple-400 flex items-center gap-2">
                  <span className="text-2xl">✈️</span> Away Team
                </h3>
                <select
                  className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-purple-400 focus:outline-none"
                  value={selectedAwayTeam?.Team || ""}
                  onChange={(e) => {
                    const team = teams.find(t => t.Team === e.target.value);
                    setSelectedAwayTeam(team);
                  }}
                >
                  <option value="">Select Away Team</option>
                  {teams.map((team) => (
                    <option key={team.Team} value={team.Team}>
                      {team.Team}
                    </option>
                  ))}
                </select>
                
                {selectedAwayTeam && (
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">PPD:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, [
                          'Offensive Pts/Drive',
                          'Offensive PPD',
                          'PPD',
                          'Off PPD',
                          'ppd',
                          'offensive_ppd'
                        ])}
                      </div>
                      <div className="text-slate-400">EPA/play:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, [
                          'Offensive EPA/Play',
                          'Offensive EPA/play',
                          'EPA/play',
                          'EPA_play',
                          'Off EPA',
                          'offensive_epa'
                        ])}
                      </div>
                      <div className="text-slate-400">Success Rate:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, [
                          'Offensive Success Rate',
                          'Offensive Success rate',
                          'Success_rate',
                          'Success rate',
                          'SR',
                          'offensive_sr'
                        ])}
                      </div>
                    </div>
                    <button
                      onClick={() => console.log("Away team full data:", selectedAwayTeam)}
                      className="mt-2 text-xs text-slate-500 hover:text-slate-400 underline"
                    >
                      Debug: Log full team data to console
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Game Settings */}
            <div className="bg-slate-800 rounded-xl p-6 mb-8 border border-slate-700 shadow-2xl">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-blue-400" />
                Game Settings
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Betting Lines */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Over/Under Line
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.overUnderLine}
                    onChange={(e) => setGameSettings({...gameSettings, overUnderLine: parseFloat(e.target.value)})}
                  />
                </div>

                {/* Weather Settings */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Wind Speed (MPH)
                  </label>
                  <input
                    type="number"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.windMPH}
                    onChange={(e) => setGameSettings({...gameSettings, windMPH: parseInt(e.target.value)})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Temperature (°F)
                  </label>
                  <input
                    type="number"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.temperature}
                    onChange={(e) => setGameSettings({...gameSettings, temperature: parseInt(e.target.value)})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Precipitation
                  </label>
                  <select
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.precipitation}
                    onChange={(e) => setGameSettings({...gameSettings, precipitation: e.target.value})}
                  >
                    <option value="none">None</option>
                    <option value="light_rain">Light Rain</option>
                    <option value="heavy_rain">Heavy Rain</option>
                    <option value="snow">Snow</option>
                  </select>
                </div>

                {/* Other Settings */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    # of Simulations
                  </label>
                  <input
                    type="number"
                    step="1000"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.numSimulations}
                    onChange={(e) => setGameSettings({...gameSettings, numSimulations: parseInt(e.target.value)})}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded bg-slate-900 border-slate-600 text-blue-500 focus:ring-blue-400"
                      checked={gameSettings.isDome}
                      onChange={(e) => setGameSettings({...gameSettings, isDome: e.target.checked})}
                    />
                    <div>
                      <span className="text-slate-300 font-medium">Dome Game</span>
                      <p className="text-xs text-slate-500">+1.5 pts (removes weather drag)</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Run Simulation Button */}
              <button
                onClick={runSimulation}
                disabled={!selectedHomeTeam || !selectedAwayTeam || isSimulating}
                className="mt-6 w-full bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 disabled:from-slate-600 disabled:to-slate-700 text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center gap-3 transition-all shadow-lg text-lg border-2 border-yellow-400"
              >
                <Play className="w-6 h-6" />
                {isSimulating ? "SIMULATING..." : `RUN ${gameSettings.numSimulations.toLocaleString()} SIMULATIONS`}
              </button>
            </div>

            {/* Results Section */}
            {simulationResults && (
              <div className="space-y-6">
                {/* Model Info */}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                  <h3 className="text-xl font-bold mb-4">Simulation Parameters</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-slate-400">Correlation (ρ)</div>
                      <div className="text-blue-400 font-bold text-lg">{simulationResults.correlationUsed.toFixed(3)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Weather Impact</div>
                      <div className="text-blue-400 font-bold text-lg">
                        {simulationResults.weatherAdjustment >= 0 ? '+' : ''}{simulationResults.weatherAdjustment.toFixed(1)} pts
                      </div>
                      <div className="text-xs text-slate-500">
                        ({simulationResults.weatherAdjustment >= 0 ? '+' : ''}{(simulationResults.weatherAdjustment * 0.5).toFixed(1)} per team)
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Simulations</div>
                      <div className="text-blue-400 font-bold text-lg">{simulationResults.numSimulations.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Database</div>
                      <div className="text-blue-400 font-bold text-lg">{teams.length} Teams</div>
                    </div>
                  </div>
                </div>

                {/* Game Total O/U */}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-blue-400" />
                    Over/Under Analysis (Line: {simulationResults.overUnder.line})
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 p-4 rounded-lg border border-green-600/30">
                      <div className="text-sm text-green-300 mb-1">Over {simulationResults.overUnder.line}</div>
                      <div className="text-3xl font-bold text-green-400">
                        {simulationResults.overUnder.overPct.toFixed(1)}%
                      </div>
                      <div className="text-xs text-green-300 mt-1">
                        {Math.round((simulationResults.overUnder.overPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-red-600/20 to-red-800/20 p-4 rounded-lg border border-red-600/30">
                      <div className="text-sm text-red-300 mb-1">Under {simulationResults.overUnder.line}</div>
                      <div className="text-3xl font-bold text-red-400">
                        {simulationResults.overUnder.underPct.toFixed(1)}%
                      </div>
                      <div className="text-xs text-red-300 mt-1">
                        {Math.round((simulationResults.overUnder.underPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-slate-600/20 to-slate-800/20 p-4 rounded-lg border border-slate-600/30">
                      <div className="text-sm text-slate-300 mb-1">Push</div>
                      <div className="text-3xl font-bold text-slate-400">
                        {simulationResults.overUnder.pushPct.toFixed(1)}%
                      </div>
                      <div className="text-xs text-slate-300 mt-1">
                        {Math.round((simulationResults.overUnder.pushPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                      </div>
                    </div>
                  </div>
                </div>

                {/* Moneyline Analysis */}
                {simulationResults.moneyline && (
                  <div className="bg-slate-800 p-6 rounded-lg border border-emerald-700/50">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <TrendingUp className="w-6 h-6 text-emerald-400" />
                      Moneyline (Win Probability)
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/20 p-4 rounded-lg border border-orange-600/30">
                        <div className="text-sm text-orange-300 mb-1">{simulationResults.homeTeam} Win</div>
                        <div className="text-3xl font-bold text-orange-400">
                          {simulationResults.moneyline.homeWinPct.toFixed(1)}%
                        </div>
                        <div className="text-sm text-orange-300 mt-2">
                          Fair Odds: {simulationResults.moneyline.homeFairOdds > 0 ? '+' : ''}{simulationResults.moneyline.homeFairOdds}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Implied prob: {simulationResults.moneyline.homeWinPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 p-4 rounded-lg border border-purple-600/30">
                        <div className="text-sm text-purple-300 mb-1">{simulationResults.awayTeam} Win</div>
                        <div className="text-3xl font-bold text-purple-400">
                          {simulationResults.moneyline.awayWinPct.toFixed(1)}%
                        </div>
                        <div className="text-sm text-purple-300 mt-2">
                          Fair Odds: {simulationResults.moneyline.awayFairOdds > 0 ? '+' : ''}{simulationResults.moneyline.awayFairOdds}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Implied prob: {simulationResults.moneyline.awayWinPct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-slate-500 bg-slate-900/50 p-3 rounded">
                      <strong>Note:</strong> Fair odds assume no vig. Actual sportsbook lines will be juiced (typically -110 both sides on spread, varies on ML).
                      Compare these fair odds to market prices to identify value.
                    </div>
                  </div>
                )}

                {/* Projected Scores */}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                  <h3 className="text-xl font-bold mb-4">Projected Scores</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-orange-300 mb-2 font-semibold">{simulationResults.homeTeam}</div>
                      <div className="text-4xl font-bold text-orange-400 mb-2">
                        {simulationResults.homeProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <div>Median: {simulationResults.homeProjection.median.toFixed(1)}</div>
                        <div>10th %: {simulationResults.homeProjection.p10.toFixed(1)}</div>
                        <div>90th %: {simulationResults.homeProjection.p90.toFixed(1)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-purple-300 mb-2 font-semibold">{simulationResults.awayTeam}</div>
                      <div className="text-4xl font-bold text-purple-400 mb-2">
                        {simulationResults.awayProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <div>Median: {simulationResults.awayProjection.median.toFixed(1)}</div>
                        <div>10th %: {simulationResults.awayProjection.p10.toFixed(1)}</div>
                        <div>90th %: {simulationResults.awayProjection.p90.toFixed(1)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-blue-300 mb-2 font-semibold">Game Total</div>
                      <div className="text-4xl font-bold text-blue-400 mb-2">
                        {simulationResults.totalProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <div>Median: {simulationResults.totalProjection.median.toFixed(1)}</div>
                        <div>10th %: {simulationResults.totalProjection.p10.toFixed(1)}</div>
                        <div>90th %: {simulationResults.totalProjection.p90.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default NFLTotalsSimulator;
