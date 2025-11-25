'use client'

import React, { useState } from "react";
import { Upload, Play, BarChart3, TrendingUp, Database, AlertCircle } from "lucide-react";

/**
 * NFL Monte Carlo Simulator - FULL COMPOSITE MODEL
 * 
 * ============================================
 * TIER 1: COMPOSITE EFFICIENCY RATING (CER)
 * ============================================
 * Uses z-score weighted composite of:
 * - PPD (0.30) - Actual scoring output
 * - EPA/play (0.25) - Most predictive efficiency metric  
 * - Success Rate (0.20) - Drive sustainability
 * - RZ TD Rate (0.10) - Finishing ability
 * - TO% (0.10 negative) - Ball security
 * - RZ Drives/Game (0.05) - Opportunity creation
 * 
 * ============================================
 * TIER 2: PACE-BASED DRIVES MODEL
 * ============================================
 * Expected Drives = f(Sec/Snap, Plays/Drive, 3-out%, Xpl%, 
 *                     No-Huddle%, Penalties/Drive, Pass Rate)
 * 
 * ============================================
 * TIER 3: MATCHUP ADJUSTMENT
 * ============================================
 * Matchup_PPD = League_PPD + λ * (Off_CER + Def_CER) * σ
 * 
 * ============================================
 * TIER 4: FINAL PROJECTION
 * ============================================
 * Expected_Points = Matchup_PPD × Expected_Drives × Weather
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
    spreadLine: -3.0,
    numSimulations: 10000,
    isDome: false,
    windMPH: 0,
    temperature: 70,
    precipitation: "none"
  });
  const [simulationResults, setSimulationResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // ============================================
  // LEAGUE PARAMETERS (W13 2024 Database - From Actual CSV Analysis)
  // ============================================
  const params = {
    lg: {
      // === CORE EFFICIENCY METRICS (Offense) ===
      PPD: 2.07488,           // SD=0.427, Range: 1.24-3.05
      PPD_sd: 0.42745,
      EPA: -0.00084,          // SD=0.094, Range: -0.19 to 0.16
      EPA_sd: 0.09376,
      SR: 0.43625,            // SD=0.035, Range: 32.8%-49.8%
      SR_sd: 0.03501,
      RZTD: 0.57717,          // SD=0.089, Range: 33.3%-75.0%
      RZTD_sd: 0.08942,
      TO_pct: 0.10805,        // SD=0.030, Range: 4.3%-16.7%
      TO_pct_sd: 0.03007,
      RZDrives: 3.27107,      // SD=0.639, Range: 1.82-4.45
      RZDrives_sd: 0.63882,
      
      // === CORE EFFICIENCY METRICS (Defense) ===
      PPD_def: 2.07108,       // SD=0.325, Range: 1.43-2.67
      PPD_def_sd: 0.32496,
      EPA_def: -0.00050,      // SD=0.078
      EPA_def_sd: 0.07836,
      SR_def: 0.43604,        // SD=0.032
      SR_def_sd: 0.03169,
      RZTD_def: 0.57712,      // SD=0.069
      RZTD_def_sd: 0.06917,
      TO_pct_def: 0.10805,    // Forced turnover rate (using offensive avg as baseline)
      TO_pct_def_sd: 0.03007,
      RZDrives_def: 3.27533,  // SD=0.502
      RZDrives_def_sd: 0.50185,
      
      // === PACE METRICS ===
      Drives: 10.79735,       // SD=0.618, Range: 9.55-11.91
      Drives_sd: 0.61829,
      SecSnap: 28.51460,      // SD=1.049, Range: 25.5-30.3
      SecSnap_sd: 1.04923,
      PlaysPerDrive: 5.69904, // SD=0.446, Range: 4.90-6.96
      PlaysPerDrive_sd: 0.44626,
      ThreeOut: 0.20567,      // SD=0.040, Range: 15.7%-30.4%
      ThreeOut_sd: 0.03964,
      Xpl: 0.08818,           // SD=0.015, Range: 5.8%-12.0%
      Xpl_sd: 0.01459,
      NoHuddle: 0.10190,      // SD=0.115 (high variance - WAS outlier at 66.7%)
      NoHuddle_sd: 0.11488,
      Pen: 0.35424,           // SD=0.065, Range: 0.21-0.47
      Pen_sd: 0.06476,
      PassRate: 0.54922,      // SD=0.047, Range: 44.8%-65.2%
      PassRate_sd: 0.04747,
      
      // === DEFENSIVE PACE ===
      Drives_def: 10.79616,
      Drives_def_sd: 0.61571,
      ThreeOut_def: 0.20558,  // SD=0.047
      ThreeOut_def_sd: 0.04722,
      Xpl_def: 0.08802,       // SD=0.017
      Xpl_def_sd: 0.01661,
      PlaysPerDrive_def: 5.69806,
      PlaysPerDrive_def_sd: 0.36760,
      SecSnap_def: 28.52732,
      SecSnap_def_sd: 1.25079,
      Pen_def: 0.35429,
      Pen_def_sd: 0.05821,
      
      // === OTHER ===
      StartingFP: 30.50313,   // SD=1.387
      StartingFP_sd: 1.38715,
    },
    
    // === MODEL COEFFICIENTS ===
    weights: {
      // Offensive CER weights (scoring potential)
      off_PPD: 0.45,
      off_EPA: 0.20,
      off_SR: 0.15,
      off_RZTD: 0.10,
      off_RZDrives: 0.07,
      off_TO: -0.03,         // Negative: higher TO% is bad
      
      // Defensive CER weights (preventing points)
      def_EPA: 0.30,
      def_SR: 0.25,
      def_RZDrives: 0.20,
      def_PPD: 0.15,
      def_RZTD: 0.07,
      def_TO: 0.03,          // Positive: more forced TOs makes defense better
    },
    
    // Pace coefficients (per 1 SD deviation)
    pace: {
      secSnap_coef: -0.08,    // Faster pace → more drives
      playsPerDrive_coef: -0.05, // Fewer plays/drive → more drives
      threeOut_coef: 0.09,    // More 3-outs → more drives (reduced from 0.12)
      xpl_coef: 0.03,         // More explosives → drives end faster (reduced from 0.04)
      noHuddle_coef: 0.06,    // No-huddle → faster pace
      pen_coef: -0.03,        // More penalties → longer drives
      passRate_coef: 0.015,   // Higher pass rate → slight pace increase (reduced from 0.02)
    },
    
    // Shrinkage and adjustments
    LAMBDA: 0.85,             // Shrinkage factor
    HOME_FIELD_ADV: 1.3,      // Home field advantage in points
    CER_TO_PPD_SCALE: 0.32,   // Scale CER z-scores to PPD adjustment
    
    // Weather coefficients
    weather: {
      dome_bonus: 1.5,
      wind_per_mph_above_threshold: -0.06,
      wind_threshold: 10,
      extreme_cold_threshold: 25,
      extreme_cold_penalty: -1.5,
      precip_adjustments: {
        none: 0,
        light_rain: -1.0,
        heavy_rain: -2.0,
        snow: -2.5,
      },
    },
  };

  const RHO_BASELINE = 0.22;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  
  /**
   * Find value from team object with multiple possible column names
   */
  const findValue = (team, possibleNames) => {
    for (let name of possibleNames) {
      if (team[name] !== undefined && team[name] !== '') {
        return team[name];
      }
    }
    return null;
  };

  /**
   * Parse percentage values - handles "44.7%", "0.447", or "44.7"
   * CRITICAL: If the original string contains '%', ALWAYS divide by 100
   */
  function parsePercent(val) {
    if (val == null || val === "") return null;
    const originalStr = String(val).trim();
    const hasPercentSign = originalStr.includes('%');
    const numStr = originalStr.replace('%', '').trim();
    const num = parseFloat(numStr);
    if (isNaN(num)) return null;
    
    // If original had '%' sign, always divide by 100 (e.g., "0.89%" → 0.0089)
    if (hasPercentSign) {
      return num / 100;
    }
    // If no '%' sign and value > 1, assume it's a percentage that needs /100
    if (num > 1) return num / 100;
    // Otherwise assume it's already a decimal
    return num;
  }

  /**
   * Calculate z-score: (value - mean) / sd
   */
  function zScore(value, mean, sd) {
    if (sd === 0) return 0;
    return (value - mean) / sd;
  }

  /**
   * Convert probability to American odds
   */
  const toAmericanOdds = (prob) => {
    if (prob <= 0) return Infinity;
    if (prob >= 1) return -Infinity;
    return prob >= 0.5 
      ? -Math.round((prob / (1 - prob)) * 100)
      : Math.round(((1 - prob) / prob) * 100);
  };

  // ============================================
  // TIER 1: COMPOSITE EFFICIENCY RATING (CER)
  // ============================================
  
  /**
   * Calculate Offensive Composite Efficiency Rating
   * Returns a z-score representing overall offensive quality
   */
  function calculateOffensiveCER(team) {
    // Extract all offensive metrics
    // Use helper to handle null/undefined but preserve valid zeros
    const getNumeric = (val, fallback) => {
      const parsed = parseFloat(val);
      return (val !== null && val !== undefined && val !== '' && !isNaN(parsed)) ? parsed : fallback;
    };
    const getPercent = (val, fallback) => {
      const parsed = parsePercent(val);
      return parsed !== null ? parsed : fallback;
    };
    
    const ppd = getNumeric(findValue(team, ['Offensive Pts/Drive', 'Offensive PPD', 'PPD']), params.lg.PPD);
    const epa = getNumeric(findValue(team, ['Offensive EPA/Play', 'Offensive EPA/play', 'EPA/play']), params.lg.EPA);
    const sr = getPercent(findValue(team, ['Offensive Success Rate', 'Offensive Success rate', 'SR']), params.lg.SR);
    const rztd = getPercent(findValue(team, ['Offensive Red Zone TD Rate', 'Offensive RZ TD%', 'RZ TD%']), params.lg.RZTD);
    const to_pct = getPercent(findValue(team, ['Offensive TO%', 'TO%', 'Turnover%']), params.lg.TO_pct);
    const rzDrives = getNumeric(findValue(team, ['Offensive Red Zone Drives/Game', 'RZ Drives/Game']), params.lg.RZDrives);
    
    // Calculate z-scores for each metric
    const z_ppd = zScore(ppd, params.lg.PPD, params.lg.PPD_sd);
    const z_epa = zScore(epa, params.lg.EPA, params.lg.EPA_sd);
    const z_sr = zScore(sr, params.lg.SR, params.lg.SR_sd);
    const z_rztd = zScore(rztd, params.lg.RZTD, params.lg.RZTD_sd);
    const z_to = zScore(to_pct, params.lg.TO_pct, params.lg.TO_pct_sd);
    const z_rzDrives = zScore(rzDrives, params.lg.RZDrives, params.lg.RZDrives_sd);
    
    // Weighted composite
    const CER = (
      params.weights.off_PPD * z_ppd +
      params.weights.off_EPA * z_epa +
      params.weights.off_SR * z_sr +
      params.weights.off_RZTD * z_rztd +
      params.weights.off_TO * z_to +      // Note: negative weight, so high TO% hurts
      params.weights.off_RZDrives * z_rzDrives
    );
    
    console.log(`  OFF CER ${team.Team}: PPD=${ppd.toFixed(2)} (z=${z_ppd.toFixed(2)}), EPA=${epa.toFixed(3)} (z=${z_epa.toFixed(2)}), SR=${(sr*100).toFixed(1)}% (z=${z_sr.toFixed(2)}), RZTD=${(rztd*100).toFixed(1)}% (z=${z_rztd.toFixed(2)}), TO=${(to_pct*100).toFixed(1)}% (z=${z_to.toFixed(2)}), RZD=${rzDrives.toFixed(1)} (z=${z_rzDrives.toFixed(2)}) → CER=${CER.toFixed(3)}`);
    
    return {
      CER,
      components: { ppd, epa, sr, rztd, to_pct, rzDrives },
      zScores: { z_ppd, z_epa, z_sr, z_rztd, z_to, z_rzDrives }
    };
  }

  /**
   * Calculate Defensive Composite Efficiency Rating
   * Returns a z-score representing overall defensive quality
   * Note: For defense, LOWER stats are better, so we flip signs
   */
  function calculateDefensiveCER(team) {
    // Use helper to handle null/undefined but preserve valid zeros
    const getNumeric = (val, fallback) => {
      const parsed = parseFloat(val);
      return (val !== null && val !== undefined && val !== '' && !isNaN(parsed)) ? parsed : fallback;
    };
    const getPercent = (val, fallback) => {
      const parsed = parsePercent(val);
      return parsed !== null ? parsed : fallback;
    };
    
    // Extract all defensive metrics (what the defense ALLOWS)
    const ppd = getNumeric(findValue(team, ['Defensive Pts/Drive', 'Defensive PPD', 'Def PPD']), params.lg.PPD_def);
    const epa = getNumeric(findValue(team, ['Defensive EPA/Play', 'Defensive EPA/play', 'Def EPA']), params.lg.EPA_def);
    const sr = getPercent(findValue(team, ['Defensive Success Rate', 'Defensive Success rate', 'Def SR']), params.lg.SR_def);
    const rztd = getPercent(findValue(team, ['Defensive Red Zone TD Rate', 'Defensive RZ TD%', 'Def RZ TD%']), params.lg.RZTD_def);
    const to_forced = getPercent(findValue(team, ['Defensive TO%', 'Def TO%', 'Forced TO%']), params.lg.TO_pct_def);
    const rzDrives = getNumeric(findValue(team, ['Defensive Red Zone Drives/Game', 'Def RZ Drives/Game']), params.lg.RZDrives_def);
    
    // Calculate z-scores - NOTE: For defense, positive z = bad defense (allows more)
    // We want CER where positive = GOOD defense, so we NEGATE
    const z_ppd = -zScore(ppd, params.lg.PPD_def, params.lg.PPD_def_sd);
    const z_epa = -zScore(epa, params.lg.EPA_def, params.lg.EPA_def_sd);
    const z_sr = -zScore(sr, params.lg.SR_def, params.lg.SR_def_sd);
    const z_rztd = -zScore(rztd, params.lg.RZTD_def, params.lg.RZTD_def_sd);
    const z_to = zScore(to_forced, params.lg.TO_pct_def, params.lg.TO_pct_def_sd); // Positive: more forced TOs is good
    const z_rzDrives = -zScore(rzDrives, params.lg.RZDrives_def, params.lg.RZDrives_def_sd);
    
    // Weighted composite (positive CER = good defense = suppresses opponent scoring)
    const CER = (
      params.weights.def_PPD * z_ppd +
      params.weights.def_EPA * z_epa +
      params.weights.def_SR * z_sr +
      params.weights.def_RZTD * z_rztd +
      params.weights.def_TO * z_to +      // Positive weight × positive z = rewards ball-hawking
      params.weights.def_RZDrives * z_rzDrives
    );
    
    console.log(`  DEF CER ${team.Team}: PPD_allowed=${ppd.toFixed(2)} (z=${z_ppd.toFixed(2)}), EPA=${epa.toFixed(3)} (z=${z_epa.toFixed(2)}), SR=${(sr*100).toFixed(1)}% (z=${z_sr.toFixed(2)}), RZTD=${(rztd*100).toFixed(1)}% (z=${z_rztd.toFixed(2)}), TO_forced=${(to_forced*100).toFixed(1)}% (z=${z_to.toFixed(2)}), RZD=${rzDrives.toFixed(1)} (z=${z_rzDrives.toFixed(2)}) → CER=${CER.toFixed(3)}`);
    
    return {
      CER,
      components: { ppd, epa, sr, rztd, to_forced, rzDrives },
      zScores: { z_ppd, z_epa, z_sr, z_rztd, z_to, z_rzDrives }
    };
  }

  // ============================================
  // TIER 2: PACE-BASED DRIVES MODEL
  // ============================================
  
  /**
   * Calculate expected drives for a team based on pace factors
   * Returns expected drives per game for that team's OFFENSE
   */
  function calculatePaceAdjustment(team, isOffense = true) {
    const prefix = isOffense ? 'Offensive' : 'Defensive';
    
    // Extract pace metrics
    const secSnap = parseFloat(findValue(team, [`${prefix} Seconds/Snap`, `${prefix} Sec/snap`, 'SecSnap'])) || 
                    (isOffense ? params.lg.SecSnap : params.lg.SecSnap_def);
    const playsPerDrive = parseFloat(findValue(team, [`${prefix} Plays/Drive`, 'Plays/Drive'])) || 
                          (isOffense ? params.lg.PlaysPerDrive : params.lg.PlaysPerDrive_def);
    const threeOut = parsePercent(findValue(team, [isOffense ? 'Off 3-out Rate' : 'Defensive 3-out Rate', `${prefix} 3-out Rate`, '3-out Rate'])) || 
                     (isOffense ? params.lg.ThreeOut : params.lg.ThreeOut_def);
    const xpl = parsePercent(findValue(team, [`${prefix} Explosive Play Rate`, `${prefix} Explosive rate`])) || 
                (isOffense ? params.lg.Xpl : params.lg.Xpl_def);
    const noHuddle = parsePercent(findValue(team, [`${prefix} No Huddle Rate`, 'No Huddle Rate'])) || params.lg.NoHuddle;
    const pen = parseFloat(findValue(team, [`${prefix} Penalties/Drive`, 'Penalties/Drive'])) || 
                (isOffense ? params.lg.Pen : params.lg.Pen_def);
    const passRate = parsePercent(findValue(team, [`${prefix} Early Down Pass Rate`, 'Early Down Pass Rate'])) || params.lg.PassRate;
    
    // Use correct league baselines for z-scores based on offensive vs defensive
    const lg_secSnap = isOffense ? params.lg.SecSnap : params.lg.SecSnap_def;
    const lg_secSnap_sd = isOffense ? params.lg.SecSnap_sd : params.lg.SecSnap_def_sd;
    const lg_playsPerDrive = isOffense ? params.lg.PlaysPerDrive : params.lg.PlaysPerDrive_def;
    const lg_playsPerDrive_sd = isOffense ? params.lg.PlaysPerDrive_sd : params.lg.PlaysPerDrive_def_sd;
    const lg_threeOut = isOffense ? params.lg.ThreeOut : params.lg.ThreeOut_def;
    const lg_threeOut_sd = isOffense ? params.lg.ThreeOut_sd : params.lg.ThreeOut_def_sd;
    const lg_xpl = isOffense ? params.lg.Xpl : params.lg.Xpl_def;
    const lg_xpl_sd = isOffense ? params.lg.Xpl_sd : params.lg.Xpl_def_sd;
    const lg_pen = isOffense ? params.lg.Pen : params.lg.Pen_def;
    const lg_pen_sd = isOffense ? params.lg.Pen_sd : params.lg.Pen_def_sd;
    
    // Calculate z-scores using correct baselines
    const z_secSnap = zScore(secSnap, lg_secSnap, lg_secSnap_sd);
    const z_playsPerDrive = zScore(playsPerDrive, lg_playsPerDrive, lg_playsPerDrive_sd);
    const z_threeOut = zScore(threeOut, lg_threeOut, lg_threeOut_sd);
    const z_xpl = zScore(xpl, lg_xpl, lg_xpl_sd);
    const z_noHuddle = zScore(noHuddle, params.lg.NoHuddle, params.lg.NoHuddle_sd);
    const z_pen = zScore(pen, lg_pen, lg_pen_sd);
    const z_passRate = zScore(passRate, params.lg.PassRate, params.lg.PassRate_sd);
    
    // Calculate pace adjustment (how much to adjust drives from baseline)
    const paceAdj = (
      params.pace.secSnap_coef * z_secSnap +
      params.pace.playsPerDrive_coef * z_playsPerDrive +
      params.pace.threeOut_coef * z_threeOut +
      params.pace.xpl_coef * z_xpl +
      params.pace.noHuddle_coef * z_noHuddle +
      params.pace.pen_coef * z_pen +
      params.pace.passRate_coef * z_passRate
    );
    
    return {
      paceAdj,
      components: { secSnap, playsPerDrive, threeOut, xpl, noHuddle, pen, passRate },
      zScores: { z_secSnap, z_playsPerDrive, z_threeOut, z_xpl, z_noHuddle, z_pen, z_passRate }
    };
  }

  /**
   * Calculate expected drives for a matchup
   * CONSTRAINT: Drive differential rarely exceeds ±1 (drives are ~zero-sum)
   * 
   * Logic:
   * 1. Calculate GAME-LEVEL total drives from combined pace
   * 2. Split roughly 50/50
   * 3. Adjust for turnover differential (TO creates extra possession for opponent)
   * 4. Hard cap differential at ±1.0
   */
  function calculateExpectedDrives(homeTeam, awayTeam) {
    // Get pace factors for both teams (offense and defense)
    const homePace = calculatePaceAdjustment(homeTeam, true);
    const awayPace = calculatePaceAdjustment(awayTeam, true);
    const homeDefPace = calculatePaceAdjustment(homeTeam, false);
    const awayDefPace = calculatePaceAdjustment(awayTeam, false);
    
    // GAME-LEVEL pace: average of all four factors
    // This determines total possessions in the game
    const gamePaceAdj = (homePace.paceAdj + awayPace.paceAdj + homeDefPace.paceAdj + awayDefPace.paceAdj) / 4;
    
    // Total drives in the game (both teams combined)
    // Baseline ~21.6 total drives (10.8 each)
    const totalGameDrives = params.lg.Drives * 2 * (1 + gamePaceAdj);
    
    // Base split: each team gets half
    const baseDrivesEach = totalGameDrives / 2;
    
    // TURNOVER ADJUSTMENT: Extra possessions from opponent turnovers
    // If opponent has high TO%, you get extra drives (and they lose one)
    const homeTO = parsePercent(findValue(homeTeam, ['Offensive TO%', 'TO%'])) || params.lg.TO_pct;
    const awayTO = parsePercent(findValue(awayTeam, ['Offensive TO%', 'TO%'])) || params.lg.TO_pct;
    
    // Expected turnovers per team
    const homeExpectedTOs = baseDrivesEach * homeTO;
    const awayExpectedTOs = baseDrivesEach * awayTO;
    
    // Net turnover differential (positive = home team gains possessions)
    // ~80% of turnovers result in a new drive opportunity
    const turnoverSwing = (awayExpectedTOs - homeExpectedTOs) * 0.8;
    
    // Small pace differential adjustment (fast offense vs slow opponent)
    // Capped at ±0.3 drives - pace alone can't create huge differentials
    const paceEdge = (homePace.paceAdj - awayPace.paceAdj) * 0.3;
    const cappedPaceEdge = clamp(paceEdge, -0.3, 0.3);
    
    // Calculate raw drives
    let homeDrives = baseDrivesEach + (turnoverSwing / 2) + cappedPaceEdge;
    let awayDrives = baseDrivesEach - (turnoverSwing / 2) - cappedPaceEdge;
    
    // HARD CONSTRAINT: Differential cannot exceed ±1.0
    // In real NFL games, drive counts almost always within 1 of each other
    const differential = homeDrives - awayDrives;
    if (Math.abs(differential) > 1.0) {
      const excess = (Math.abs(differential) - 1.0) / 2;
      if (differential > 0) {
        homeDrives -= excess;
        awayDrives += excess;
      } else {
        homeDrives += excess;
        awayDrives -= excess;
      }
    }
    
    // Apply final bounds
    homeDrives = clamp(homeDrives, 9.0, 13.0);
    awayDrives = clamp(awayDrives, 9.0, 13.0);
    
    console.log(`  DRIVES MODEL:`);
    console.log(`    Game pace adj: ${gamePaceAdj.toFixed(3)} → Total game drives: ${totalGameDrives.toFixed(1)}`);
    console.log(`    Home TO%: ${(homeTO*100).toFixed(1)}%, Away TO%: ${(awayTO*100).toFixed(1)}%`);
    console.log(`    Turnover swing: ${turnoverSwing.toFixed(2)} drives, Pace edge: ${cappedPaceEdge.toFixed(2)}`);
    console.log(`    Final: Home ${homeDrives.toFixed(2)} drives, Away ${awayDrives.toFixed(2)} drives (diff: ${(homeDrives-awayDrives).toFixed(2)})`);
    
    return {
      homeDrives,
      awayDrives,
      totalGameDrives,
      differential: homeDrives - awayDrives,
      turnoverSwing,
      gamePaceAdj,
      homePaceDetails: homePace,
      awayPaceDetails: awayPace
    };
  }

  // ============================================
  // TIER 3: MATCHUP ADJUSTMENT
  // ============================================
  
  /**
   * Calculate matchup-adjusted PPD for each team
   * Uses CER to adjust baseline PPD based on opponent quality
   */
  function calculateMatchupPPD(homeTeam, awayTeam) {
    console.log("\n=== COMPOSITE EFFICIENCY RATINGS ===");
    
    // Get CER for each team
    const homeOffCER = calculateOffensiveCER(homeTeam);
    const homeDefCER = calculateDefensiveCER(homeTeam);
    const awayOffCER = calculateOffensiveCER(awayTeam);
    const awayDefCER = calculateDefensiveCER(awayTeam);
    
    // Matchup calculation:
    // Home team's expected PPD = league avg + (home offense CER - away defense CER) * scale
    // Away defense CER is positive when defense is GOOD, so we subtract
    const homeMatchupCER = homeOffCER.CER - awayDefCER.CER;
    const awayMatchupCER = awayOffCER.CER - homeDefCER.CER;
    
    // Convert CER to PPD adjustment
    const homePPDAdj = homeMatchupCER * params.CER_TO_PPD_SCALE;
    const awayPPDAdj = awayMatchupCER * params.CER_TO_PPD_SCALE;
    
    // Apply shrinkage and calculate final PPD
    const homeRawPPD = params.lg.PPD + homePPDAdj;
    const awayRawPPD = params.lg.PPD + awayPPDAdj;
    
    // Apply shrinkage toward league mean
    const homePPD = params.lg.PPD + params.LAMBDA * (homeRawPPD - params.lg.PPD);
    const awayPPD = params.lg.PPD + params.LAMBDA * (awayRawPPD - params.lg.PPD);
    
    // Add home field advantage (in PPD terms)
    const homeAdvPPD = params.HOME_FIELD_ADV / params.lg.Drives;
    const homeFinalPPD = homePPD + homeAdvPPD;
    
    console.log(`\n=== MATCHUP PPD ===`);
    console.log(`  Home CER matchup: ${homeOffCER.CER.toFixed(3)} (off) - ${awayDefCER.CER.toFixed(3)} (opp def) = ${homeMatchupCER.toFixed(3)}`);
    console.log(`  Away CER matchup: ${awayOffCER.CER.toFixed(3)} (off) - ${homeDefCER.CER.toFixed(3)} (opp def) = ${awayMatchupCER.toFixed(3)}`);
    console.log(`  Home PPD: ${params.lg.PPD.toFixed(2)} + ${homePPDAdj.toFixed(3)} = ${homeRawPPD.toFixed(3)} → shrunk to ${homePPD.toFixed(3)} + HFA ${homeAdvPPD.toFixed(3)} = ${homeFinalPPD.toFixed(3)}`);
    console.log(`  Away PPD: ${params.lg.PPD.toFixed(2)} + ${awayPPDAdj.toFixed(3)} = ${awayRawPPD.toFixed(3)} → shrunk to ${awayPPD.toFixed(3)}`);
    
    return {
      homePPD: clamp(homeFinalPPD, 1.2, 3.5),
      awayPPD: clamp(awayPPD, 1.2, 3.5),
      homeOffCER,
      homeDefCER,
      awayOffCER,
      awayDefCER
    };
  }

  // ============================================
  // CORRELATION CALCULATION
  // ============================================
  
  function calculateAdaptiveCorrelation(homeTeam, awayTeam, spread, isDome, windMPH, precip) {
    let rho = RHO_BASELINE;
    
    // 1. Competitiveness factor
    const absSpread = Math.abs(spread);
    if (absSpread <= 3) rho += 0.10;
    else if (absSpread <= 7) rho += 0.05;
    else if (absSpread >= 14) rho -= 0.10;
    
    // 2. Style alignment (pass rate)
    const homePassRate = parsePercent(findValue(homeTeam, ['Offensive Early Down Pass Rate', 'PassRate'])) || params.lg.PassRate;
    const awayPassRate = parsePercent(findValue(awayTeam, ['Offensive Early Down Pass Rate', 'PassRate'])) || params.lg.PassRate;
    const passRateDiff = Math.abs(homePassRate - awayPassRate);
    if (passRateDiff < 0.05) rho += 0.08;
    else if (passRateDiff > 0.15) rho -= 0.05;
    
    // 3. Explosive play tendency 
    // Mean=8.82% each, P75=9.87%, so combined >19% means both above P75
    const homeXpl = parsePercent(findValue(homeTeam, ['Offensive Explosive Play Rate'])) || params.lg.Xpl;
    const awayXpl = parsePercent(findValue(awayTeam, ['Offensive Explosive Play Rate'])) || params.lg.Xpl;
    if (homeXpl + awayXpl > 0.19) rho += 0.05;  // Both teams above P75
    
    // 4. Environmental factors
    if (isDome) rho += 0.05;
    if (windMPH > 15) rho -= 0.15;
    else if (windMPH > 10) rho -= 0.08;
    
    if (precip === "heavy_rain" || precip === "snow") rho -= 0.10;
    else if (precip === "light_rain") rho -= 0.05;
    
    // 5. Pace coupling 
    // P10=27.4 (fast), P50=28.6, P90=29.8 (slow)
    const homeSecSnap = parseFloat(findValue(homeTeam, ['Offensive Seconds/Snap'])) || params.lg.SecSnap;
    const awaySecSnap = parseFloat(findValue(awayTeam, ['Offensive Seconds/Snap'])) || params.lg.SecSnap;
    const avgPace = (homeSecSnap + awaySecSnap) / 2;
    if (avgPace < 27.4) rho += 0.05;       // Both teams fast (below P10)
    else if (avgPace > 29.8) rho -= 0.03;  // Both teams slow (above P90)
    
    return clamp(rho, -0.05, 0.60);
  }

  // ============================================
  // WEATHER ADJUSTMENT
  // ============================================
  
  function calculateWeatherAdjustment(settings) {
    let weatherAdj = 0;
    
    if (settings.isDome) {
      weatherAdj += params.weather.dome_bonus;
    } else {
      // Wind effect
      if (settings.windMPH > params.weather.wind_threshold) {
        const windEffect = (settings.windMPH - params.weather.wind_threshold) * 
                          params.weather.wind_per_mph_above_threshold;
        weatherAdj += windEffect;
      }
      
      // Temperature effect
      if (settings.temperature < params.weather.extreme_cold_threshold) {
        weatherAdj += params.weather.extreme_cold_penalty;
      }
      
      // Precipitation effect
      weatherAdj += params.weather.precip_adjustments[settings.precipitation] || 0;
    }
    
    return weatherAdj;
  }

  // ============================================
  // CSV PARSING
  // ============================================
  
  function parseCSV(csvText) {
    // Remove BOM character if present
    let cleanedText = csvText;
    if (cleanedText.charCodeAt(0) === 0xFEFF) {
      cleanedText = cleanedText.slice(1);
    }
    
    const lines = cleanedText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error("CSV file appears to be empty or invalid");
    }

    const headers = parseCSVLine(lines[0]);
    const teamData = [];

    console.log("CSV Headers found:", headers);

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < headers.length - 5) continue;

      const team = {};
      headers.forEach((header, index) => {
        if (index < values.length) {
          // Also strip BOM from any header that might have it
          const cleanHeader = header.replace(/^\uFEFF/, '');
          team[cleanHeader] = values[index];
        }
      });

      // Handle team name - check various possible column names
      const teamName = team.team || team.Team || team['\ufeffteam'];
      if (teamName) {
        team.Team = teamName;
        teamData.push(team);
      }
    }

    if (teamData.length === 0) {
      throw new Error("No valid team data found. Please check CSV format.");
    }

    return teamData;
  }

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

  const getDisplayValue = (team, possibleNames) => {
    for (let name of possibleNames) {
      const value = team[name];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return 'N/A';
  };

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
        
        console.log(`Successfully loaded ${parsedTeams.length} teams`);
        console.log("Sample team data:", parsedTeams[0]);
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

  // ============================================
  // MAIN SIMULATION
  // ============================================
  
  const runSimulation = () => {
    if (!selectedHomeTeam || !selectedAwayTeam) {
      alert("Please select both home and away teams");
      return;
    }

    setIsSimulating(true);
    
    setTimeout(() => {
      try {
        const results = simulateGame(selectedHomeTeam, selectedAwayTeam, gameSettings);
        setSimulationResults(results);
      } catch (error) {
        alert(`Simulation error: ${error.message}`);
        console.error(error);
      } finally {
        setIsSimulating(false);
      }
    }, 100);
  };

  function simulateGame(homeTeam, awayTeam, settings) {
    const numSims = settings.numSimulations;
    
    console.log("\n========================================");
    console.log(`SIMULATION: ${homeTeam.Team} vs ${awayTeam.Team}`);
    console.log("========================================");
    
    // TIER 1 & 3: Calculate matchup-adjusted PPD using CER
    const matchup = calculateMatchupPPD(homeTeam, awayTeam);
    
    // TIER 2: Calculate expected drives based on pace (correlated model)
    const drives = calculateExpectedDrives(homeTeam, awayTeam);
    
    console.log(`  Drive differential: ${drives.differential.toFixed(2)} (capped at ±1.0)`);
    
    // Calculate correlation
    const rho = calculateAdaptiveCorrelation(
      homeTeam, awayTeam,
      settings.spread,
      settings.isDome,
      settings.windMPH,
      settings.precipitation
    );
    
    // Calculate weather adjustment
    const weatherAdj = calculateWeatherAdjustment(settings);
    
    // TIER 4: Calculate expected points
    const homeExpPts = matchup.homePPD * drives.homeDrives + (weatherAdj / 2);
    const awayExpPts = matchup.awayPPD * drives.awayDrives + (weatherAdj / 2);
    
    console.log(`\n=== FINAL PROJECTIONS ===`);
    console.log(`  Home: ${matchup.homePPD.toFixed(3)} PPD × ${drives.homeDrives.toFixed(2)} drives + ${(weatherAdj/2).toFixed(1)} weather = ${homeExpPts.toFixed(1)} pts`);
    console.log(`  Away: ${matchup.awayPPD.toFixed(3)} PPD × ${drives.awayDrives.toFixed(2)} drives + ${(weatherAdj/2).toFixed(1)} weather = ${awayExpPts.toFixed(1)} pts`);
    console.log(`  Total: ${(homeExpPts + awayExpPts).toFixed(1)} | Correlation: ${rho.toFixed(3)}`);
    console.log(`========================================\n`);
    
    // Run Monte Carlo simulations
    const results = {
      homeScores: [],
      awayScores: [],
      totals: [],
      margins: [],
      correlationUsed: rho,
      weatherAdjustment: weatherAdj,
      homeExpectedPts: homeExpPts,
      awayExpectedPts: awayExpPts,
      homeDrives: drives.homeDrives,
      awayDrives: drives.awayDrives,
      totalGameDrives: drives.totalGameDrives,
      driveDifferential: drives.differential,
      turnoverSwing: drives.turnoverSwing,
      gamePaceAdj: drives.gamePaceAdj,
      matchupDetails: matchup
    };
    
    // Heteroskedastic sigma function
    const sigmaTeam = (expectedPts) => Math.max(6.5, Math.min(9.5, 5.5 + 0.15 * (expectedPts - 20)));
    
    for (let i = 0; i < numSims; i++) {
      // Generate correlated random values (Box-Muller)
      const u1 = Math.random();
      const u2 = Math.random();
      const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      
      const homeRandom = z1;
      const awayRandom = rho * z1 + Math.sqrt(1 - rho * rho) * z2;
      
      // Calculate scores with heteroskedastic noise
      const homeScore = Math.max(0, homeExpPts + homeRandom * sigmaTeam(homeExpPts));
      const awayScore = Math.max(0, awayExpPts + awayRandom * sigmaTeam(awayExpPts));
      
      const homeScoreRounded = Math.round(homeScore);
      const awayScoreRounded = Math.round(awayScore);
      
      results.homeScores.push(homeScoreRounded);
      results.awayScores.push(awayScoreRounded);
      results.totals.push(homeScoreRounded + awayScoreRounded);
      results.margins.push(homeScoreRounded - awayScoreRounded);
    }
    
    return calculateResults(results, settings, homeTeam.Team, awayTeam.Team);
  }

  function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function calculateResults(results, settings, homeTeamName, awayTeamName) {
    const homeScores = results.homeScores;
    const awayScores = results.awayScores;
    const totals = results.totals;
    const margins = results.margins;
    const n = settings.numSimulations;

    // Over/Under analysis
    let overCount = 0, underCount = 0, pushCount = 0;
    totals.forEach(total => {
      if (total > settings.overUnderLine) overCount++;
      else if (total < settings.overUnderLine) underCount++;
      else pushCount++;
    });

    // Home team total
    let homeOverCount = 0, homeUnderCount = 0, homePushCount = 0;
    homeScores.forEach(score => {
      if (score > settings.homeTeamTotal) homeOverCount++;
      else if (score < settings.homeTeamTotal) homeUnderCount++;
      else homePushCount++;
    });

    // Away team total
    let awayOverCount = 0, awayUnderCount = 0, awayPushCount = 0;
    awayScores.forEach(score => {
      if (score > settings.awayTeamTotal) awayOverCount++;
      else if (score < settings.awayTeamTotal) awayUnderCount++;
      else awayPushCount++;
    });

    // Moneyline
    let homeWinCount = 0, awayWinCount = 0;
    margins.forEach(margin => {
      if (margin > 0) homeWinCount++;
      else if (margin < 0) awayWinCount++;
    });

    // Spread analysis
    const spreadLine = settings.spreadLine;
    let homeCoverCount = 0, awayCoverCount = 0, spreadPushCount = 0;
    margins.forEach(margin => {
      const threshold = -spreadLine;
      if (margin > threshold) homeCoverCount++;
      else if (margin < threshold) awayCoverCount++;
      else spreadPushCount++;
    });

    // Alt-lines
    const altLines = [-14, -10.5, -7, -6.5, -3.5, -3, -2.5, -1.5, 0, +1.5, +2.5, +3, +3.5, +6.5, +7, +10.5, +14];
    const altLinesAnalysis = altLines.map(line => {
      let coverCount = 0;
      margins.forEach(margin => {
        if (margin > -line) coverCount++;
      });
      return { line, coverPct: (coverCount / n) * 100 };
    });

    return {
      numSimulations: n,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      correlationUsed: results.correlationUsed,
      weatherAdjustment: results.weatherAdjustment,
      homeExpectedPts: results.homeExpectedPts,
      awayExpectedPts: results.awayExpectedPts,
      homeDrives: results.homeDrives,
      awayDrives: results.awayDrives,
      totalGameDrives: results.totalGameDrives,
      driveDifferential: results.driveDifferential,
      turnoverSwing: results.turnoverSwing,
      gamePaceAdj: results.gamePaceAdj,
      matchupDetails: results.matchupDetails,
      
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
      
      moneyline: {
        homeWinPct: (homeWinCount / n) * 100,
        awayWinPct: (awayWinCount / n) * 100,
        homeFairOdds: toAmericanOdds(homeWinCount / n),
        awayFairOdds: toAmericanOdds(awayWinCount / n),
      },
      
      spread: {
        line: spreadLine,
        homeCoverPct: (homeCoverCount / n) * 100,
        awayCoverPct: (awayCoverCount / n) * 100,
        pushPct: (spreadPushCount / n) * 100,
        altLines: altLinesAnalysis,
      },
      
      homeProjection: {
        mean: homeScores.reduce((a, b) => a + b, 0) / n,
        median: percentile(homeScores, 50),
        p10: percentile(homeScores, 10),
        p90: percentile(homeScores, 90),
      },
      
      awayProjection: {
        mean: awayScores.reduce((a, b) => a + b, 0) / n,
        median: percentile(awayScores, 50),
        p10: percentile(awayScores, 10),
        p90: percentile(awayScores, 90),
      },
      
      totalProjection: {
        mean: totals.reduce((a, b) => a + b, 0) / n,
        median: percentile(totals, 50),
        p10: percentile(totals, 10),
        p90: percentile(totals, 90),
      },
      
      marginProjection: {
        mean: margins.reduce((a, b) => a + b, 0) / n,
        median: percentile(margins, 50),
        p10: percentile(margins, 10),
        p90: percentile(margins, 90),
      },
    };
  }

  // ============================================
  // RENDER
  // ============================================
  
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
            🏈 Full Composite Model • CER + Pace Engine 🎰
          </p>
          <div className="flex justify-center gap-3 text-xs text-slate-300">
            <span className="bg-red-600/30 px-3 py-1 rounded-full border border-red-500">● PPD + EPA + SR</span>
            <span className="bg-yellow-600/30 px-3 py-1 rounded-full border border-yellow-500">● RZ + TO%</span>
            <span className="bg-green-600/30 px-3 py-1 rounded-full border border-green-500">● PACE MODEL</span>
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
                Upload your NFL team statistics CSV. This model uses ALL columns:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-yellow-200 mb-4 font-semibold">
                <div className="text-green-400">✓ Offensive Pts/Drive</div>
                <div className="text-green-400">✓ Offensive EPA/Play</div>
                <div className="text-green-400">✓ Offensive Success Rate</div>
                <div className="text-green-400">✓ Offensive Red Zone TD Rate</div>
                <div className="text-green-400">✓ Offensive TO%</div>
                <div className="text-green-400">✓ Offensive RZ Drives/Game</div>
                <div className="text-blue-400">✓ Offensive Seconds/Snap</div>
                <div className="text-blue-400">✓ Offensive Plays/Drive</div>
                <div className="text-blue-400">✓ Off 3-out Rate</div>
                <div className="text-blue-400">✓ Offensive Explosive Rate</div>
                <div className="text-blue-400">✓ Offensive No Huddle Rate</div>
                <div className="text-blue-400">✓ Offensive Penalties/Drive</div>
                <div className="text-blue-400">✓ Early Down Pass Rate</div>
                <div className="text-purple-400">✓ All Defensive equivalents</div>
              </div>
              <p className="text-xs text-yellow-300 font-semibold">
                GREEN = Core Efficiency | BLUE = Pace Model | PURPLE = Defensive
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

        {/* Main Interface */}
        {csvUploaded && (
          <>
            {/* CSV Info */}
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
                    Show all column names
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
                  }}
                >
                  <option value="">Select Home Team</option>
                  {teams.map((team) => (
                    <option key={team.Team} value={team.Team}>{team.Team}</option>
                  ))}
                </select>
                
                {selectedHomeTeam && (
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">PPD:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, ['Offensive Pts/Drive'])}
                      </div>
                      <div className="text-slate-400">EPA/play:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, ['Offensive EPA/Play'])}
                      </div>
                      <div className="text-slate-400">Success Rate:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, ['Offensive Success Rate'])}
                      </div>
                      <div className="text-slate-400">RZ TD%:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, ['Offensive Red Zone TD Rate'])}
                      </div>
                      <div className="text-slate-400">TO%:</div>
                      <div className="text-orange-300 font-semibold">
                        {getDisplayValue(selectedHomeTeam, ['Offensive TO%'])}
                      </div>
                    </div>
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
                    <option key={team.Team} value={team.Team}>{team.Team}</option>
                  ))}
                </select>
                
                {selectedAwayTeam && (
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">PPD:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, ['Offensive Pts/Drive'])}
                      </div>
                      <div className="text-slate-400">EPA/play:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, ['Offensive EPA/Play'])}
                      </div>
                      <div className="text-slate-400">Success Rate:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, ['Offensive Success Rate'])}
                      </div>
                      <div className="text-slate-400">RZ TD%:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, ['Offensive Red Zone TD Rate'])}
                      </div>
                      <div className="text-slate-400">TO%:</div>
                      <div className="text-purple-300 font-semibold">
                        {getDisplayValue(selectedAwayTeam, ['Offensive TO%'])}
                      </div>
                    </div>
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
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Spread (Home)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.spreadLine}
                    onChange={(e) => setGameSettings({...gameSettings, spreadLine: parseFloat(e.target.value), spread: parseFloat(e.target.value)})}
                    placeholder="-3"
                  />
                  <p className="text-xs text-slate-500 mt-1">Negative = home favored</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Home Team Total
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.homeTeamTotal}
                    onChange={(e) => setGameSettings({...gameSettings, homeTeamTotal: parseFloat(e.target.value)})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Away Team Total
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-blue-400 focus:outline-none"
                    value={gameSettings.awayTeamTotal}
                    onChange={(e) => setGameSettings({...gameSettings, awayTeamTotal: parseFloat(e.target.value)})}
                  />
                </div>

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
                      <p className="text-xs text-slate-500">+1.5 pts (optimal conditions)</p>
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
                  <h3 className="text-xl font-bold mb-4">Model Parameters</h3>
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
                    </div>
                    <div>
                      <div className="text-slate-400">Game Pace Adj</div>
                      <div className="text-blue-400 font-bold text-lg">
                        {simulationResults.gamePaceAdj >= 0 ? '+' : ''}{(simulationResults.gamePaceAdj * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Total Game Drives</div>
                      <div className="text-blue-400 font-bold text-lg">{simulationResults.totalGameDrives.toFixed(1)}</div>
                    </div>
                  </div>
                  
                  {/* Drives Model Details */}
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-sm text-slate-400 mb-2">Correlated Drives Model</div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-orange-900/20 p-3 rounded border border-orange-600/30">
                        <div className="text-xs text-orange-300">Home Drives</div>
                        <div className="text-xl font-bold text-orange-400">{simulationResults.homeDrives.toFixed(2)}</div>
                      </div>
                      <div className="bg-purple-900/20 p-3 rounded border border-purple-600/30">
                        <div className="text-xs text-purple-300">Away Drives</div>
                        <div className="text-xl font-bold text-purple-400">{simulationResults.awayDrives.toFixed(2)}</div>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded border border-slate-600/30">
                        <div className="text-xs text-slate-300">Differential</div>
                        <div className="text-xl font-bold text-slate-300">
                          {simulationResults.driveDifferential >= 0 ? '+' : ''}{simulationResults.driveDifferential.toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-500">(capped ±1.0)</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      TO swing: {simulationResults.turnoverSwing >= 0 ? '+' : ''}{simulationResults.turnoverSwing.toFixed(2)} drives to home team
                    </div>
                  </div>
                  
                  {/* CER Details */}
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-sm text-slate-400 mb-2">Composite Efficiency Ratings</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-slate-400 mb-1">Home Offensive CER</div>
                        <div className="text-orange-400 font-semibold">
                          {simulationResults.matchupDetails.homeOffCER.CER.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1">Away Offensive CER</div>
                        <div className="text-purple-400 font-semibold">
                          {simulationResults.matchupDetails.awayOffCER.CER.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1">Home Defensive CER</div>
                        <div className="text-orange-400 font-semibold">
                          {simulationResults.matchupDetails.homeDefCER.CER.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 mb-1">Away Defensive CER</div>
                        <div className="text-purple-400 font-semibold">
                          {simulationResults.matchupDetails.awayDefCER.CER.toFixed(3)}
                        </div>
                      </div>
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
                    </div>
                    <div className="bg-gradient-to-br from-red-600/20 to-red-800/20 p-4 rounded-lg border border-red-600/30">
                      <div className="text-sm text-red-300 mb-1">Under {simulationResults.overUnder.line}</div>
                      <div className="text-3xl font-bold text-red-400">
                        {simulationResults.overUnder.underPct.toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-slate-600/20 to-slate-800/20 p-4 rounded-lg border border-slate-600/30">
                      <div className="text-sm text-slate-300 mb-1">Push</div>
                      <div className="text-3xl font-bold text-slate-400">
                        {simulationResults.overUnder.pushPct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Moneyline Analysis */}
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
                    </div>
                    <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 p-4 rounded-lg border border-purple-600/30">
                      <div className="text-sm text-purple-300 mb-1">{simulationResults.awayTeam} Win</div>
                      <div className="text-3xl font-bold text-purple-400">
                        {simulationResults.moneyline.awayWinPct.toFixed(1)}%
                      </div>
                      <div className="text-sm text-purple-300 mt-2">
                        Fair Odds: {simulationResults.moneyline.awayFairOdds > 0 ? '+' : ''}{simulationResults.moneyline.awayFairOdds}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Spread Analysis */}
                <div className="bg-slate-800 p-6 rounded-lg border border-yellow-700/50">
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-6 h-6 text-yellow-400" />
                    Spread Analysis (Line: {simulationResults.spread.line > 0 ? '+' : ''}{simulationResults.spread.line})
                  </h3>
                  
                  {/* Main Spread Results */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/20 p-4 rounded-lg border border-orange-600/30">
                      <div className="text-sm text-orange-300 mb-1">
                        {simulationResults.homeTeam} {simulationResults.spread.line > 0 ? '+' : ''}{simulationResults.spread.line}
                      </div>
                      <div className="text-3xl font-bold text-orange-400">
                        {simulationResults.spread.homeCoverPct.toFixed(1)}%
                      </div>
                      <div className="text-xs text-orange-300 mt-1">
                        {simulationResults.spread.homeCoverPct > 52.4 ? '✓ +EV vs -110' : ''}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 p-4 rounded-lg border border-purple-600/30">
                      <div className="text-sm text-purple-300 mb-1">
                        {simulationResults.awayTeam} {-simulationResults.spread.line > 0 ? '+' : ''}{-simulationResults.spread.line}
                      </div>
                      <div className="text-3xl font-bold text-purple-400">
                        {simulationResults.spread.awayCoverPct.toFixed(1)}%
                      </div>
                      <div className="text-xs text-purple-300 mt-1">
                        {simulationResults.spread.awayCoverPct > 52.4 ? '✓ +EV vs -110' : ''}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-slate-600/20 to-slate-800/20 p-4 rounded-lg border border-slate-600/30">
                      <div className="text-sm text-slate-300 mb-1">Push</div>
                      <div className="text-3xl font-bold text-slate-400">
                        {simulationResults.spread.pushPct.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Projected Margin */}
                  <div className="bg-slate-900/50 p-4 rounded-lg mb-6">
                    <div className="text-sm text-slate-400 mb-2">Projected Margin (Home - Away)</div>
                    <div className="flex items-baseline gap-4">
                      <div className="text-2xl font-bold text-yellow-400">
                        {simulationResults.marginProjection.mean >= 0 ? '+' : ''}{simulationResults.marginProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-sm text-slate-400">
                        Median: {simulationResults.marginProjection.median >= 0 ? '+' : ''}{simulationResults.marginProjection.median.toFixed(1)}
                      </div>
                      <div className="text-sm text-slate-400">
                        10th-90th: {simulationResults.marginProjection.p10.toFixed(1)} to {simulationResults.marginProjection.p90 >= 0 ? '+' : ''}{simulationResults.marginProjection.p90.toFixed(1)}
                      </div>
                    </div>
                  </div>

                  {/* Alt Lines Table */}
                  <div>
                    <div className="text-sm text-slate-400 mb-3">Alternative Lines (Home Team Cover %)</div>
                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-2">
                      {simulationResults.spread.altLines.map((alt, idx) => (
                        <div 
                          key={idx} 
                          className={`p-2 rounded text-center text-sm ${
                            alt.coverPct > 52.4 
                              ? 'bg-green-900/30 border border-green-600/50' 
                              : alt.coverPct < 47.6 
                                ? 'bg-red-900/30 border border-red-600/50'
                                : 'bg-slate-900/50 border border-slate-700'
                          }`}
                        >
                          <div className="text-xs text-slate-400">{alt.line > 0 ? '+' : ''}{alt.line}</div>
                          <div className={`font-bold ${
                            alt.coverPct > 52.4 ? 'text-green-400' : alt.coverPct < 47.6 ? 'text-red-400' : 'text-slate-300'
                          }`}>
                            {alt.coverPct.toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      Green = +EV at -110 (&gt;52.4%) | Red = -EV (&lt;47.6%)
                    </div>
                  </div>
                </div>

                {/* Team Totals Analysis */}
                <div className="bg-slate-800 p-6 rounded-lg border border-cyan-700/50">
                  <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-cyan-400" />
                    Team Totals
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    {/* Home Team Total */}
                    <div>
                      <div className="text-sm text-orange-300 font-semibold mb-3">
                        {simulationResults.homeTeam} Total (Line: {simulationResults.homeTeamOverUnder.line})
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 p-3 rounded border border-green-600/30">
                          <div className="text-xs text-green-300">Over</div>
                          <div className="text-xl font-bold text-green-400">{simulationResults.homeTeamOverUnder.overPct.toFixed(1)}%</div>
                        </div>
                        <div className="bg-gradient-to-br from-red-600/20 to-red-800/20 p-3 rounded border border-red-600/30">
                          <div className="text-xs text-red-300">Under</div>
                          <div className="text-xl font-bold text-red-400">{simulationResults.homeTeamOverUnder.underPct.toFixed(1)}%</div>
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded border border-slate-700">
                          <div className="text-xs text-slate-400">Push</div>
                          <div className="text-xl font-bold text-slate-400">{simulationResults.homeTeamOverUnder.pushPct.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Away Team Total */}
                    <div>
                      <div className="text-sm text-purple-300 font-semibold mb-3">
                        {simulationResults.awayTeam} Total (Line: {simulationResults.awayTeamOverUnder.line})
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 p-3 rounded border border-green-600/30">
                          <div className="text-xs text-green-300">Over</div>
                          <div className="text-xl font-bold text-green-400">{simulationResults.awayTeamOverUnder.overPct.toFixed(1)}%</div>
                        </div>
                        <div className="bg-gradient-to-br from-red-600/20 to-red-800/20 p-3 rounded border border-red-600/30">
                          <div className="text-xs text-red-300">Under</div>
                          <div className="text-xl font-bold text-red-400">{simulationResults.awayTeamOverUnder.underPct.toFixed(1)}%</div>
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded border border-slate-700">
                          <div className="text-xs text-slate-400">Push</div>
                          <div className="text-xl font-bold text-slate-400">{simulationResults.awayTeamOverUnder.pushPct.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

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
                        <div>Expected: {simulationResults.homeExpectedPts.toFixed(1)}</div>
                        <div>Median: {simulationResults.homeProjection.median.toFixed(1)}</div>
                        <div>10th-90th: {simulationResults.homeProjection.p10.toFixed(1)} - {simulationResults.homeProjection.p90.toFixed(1)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-purple-300 mb-2 font-semibold">{simulationResults.awayTeam}</div>
                      <div className="text-4xl font-bold text-purple-400 mb-2">
                        {simulationResults.awayProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <div>Expected: {simulationResults.awayExpectedPts.toFixed(1)}</div>
                        <div>Median: {simulationResults.awayProjection.median.toFixed(1)}</div>
                        <div>10th-90th: {simulationResults.awayProjection.p10.toFixed(1)} - {simulationResults.awayProjection.p90.toFixed(1)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-blue-300 mb-2 font-semibold">Game Total</div>
                      <div className="text-4xl font-bold text-blue-400 mb-2">
                        {simulationResults.totalProjection.mean.toFixed(1)}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1">
                        <div>Expected: {(simulationResults.homeExpectedPts + simulationResults.awayExpectedPts).toFixed(1)}</div>
                        <div>Median: {simulationResults.totalProjection.median.toFixed(1)}</div>
                        <div>10th-90th: {simulationResults.totalProjection.p10.toFixed(1)} - {simulationResults.totalProjection.p90.toFixed(1)}</div>
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
