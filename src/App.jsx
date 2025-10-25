import React, { useState } from "react";
import { Upload, Play, BarChart3, TrendingUp, Settings } from "lucide-react";

/**
 * NFL Monte Carlo Game Simulator - Discrete Drive Model
 * 
 * Features:
 * - Upload team database CSV
 * - Select home and away teams
 * - Adjust home field advantage (HFA)
 * - Run Monte Carlo simulations using discrete drive outcomes
 * - Discrete drive model: simulates each drive as TD/FG/Empty outcome
 * - Respects natural scoring lattice (0, 3, 7, 10, 13, 14, 17...)
 * - Matchup-specific variance based on team strengths
 * - View detailed probability distributions
 */

const MonteCarloSimulator = () => {
  // League baseline parameters
  const params = {
    lg: {
      PPD: 2.06,
      PPD_sd: 0.42,
      EPA: 0.022,
      EPA_sd: 0.127,
      SR: 0.43,
      SR_sd: 0.05,
      Xpl: 0.113,
      Xpl_sd: 0.033,
      RZ: 0.56,
      RZ_sd: 0.12,
      ThreeOut: 0.24,
      ThreeOut_sd: 0.05,
      Pen: 0.44,
      Pen_sd: 0.12,
      Drives: 11.6,
      SNP_ref: 29.2,
    },
    // Discrete drive model calibration parameters
    driveModel: {
      // 3-and-out logit: p_3O = σ(a0 - a1·EPA_diff - a2·SR_diff + a3·Opp_3O_rate)
      threeOut_a0: -1.10,     // Baseline intercept (~25% 3-out rate)
      threeOut_a1: 2.6,       // EPA differential coefficient (reduced from 3.5)
      threeOut_a2: 0.8,       // SR differential coefficient (raw SR scale: ~0.05 units)
      threeOut_a3: 1.5,       // Opponent 3-out rate (raw rate: 0.24 ± 0.05)
      
      // TD|sustain logit: p_TD = σ(b0 + b1·EPA_diff + b2·SR_diff + b3·RZ_diff)
      td_b0: -0.85,           // Baseline intercept (~30% TD rate when sustained, up from 24%)
      td_b1: 3.0,             // EPA differential coefficient
      td_b2: 0.6,             // SR differential coefficient
      td_b3: 1.2,             // RZ differential coefficient (raw RZ scale: ~0.12 units)
      
      // FG bias: p_FG|sustain = φ · (1 - p_TD|sustain)
      fg_phi: 0.30,           // ~20% FG among sustained at baseline (down from 45%)
    },
    weights: {
      PPD: 0.25,
      EPA: 0.40,
      SR: 0.25,
      Xpl: 0.10,
      RZ: 0.05,
      ThreeOut_eff: 0.35,
      Pen: 0.25,
      Pen_def: 0.15,
      DVOA_off: 0.5,
      DVOA_def: 0.5,
      TO_EPA: 0.1,
      FP: 0.2,
      Pace_EDPass: 0.1,
      NoHuddle: 0.2,
    },
  };

  const [teamDB, setTeamDB] = useState({});
  const [teamList, setTeamList] = useState([]);
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [hfaAdjustment, setHfaAdjustment] = useState(0);
  const [numSimulations, setNumSimulations] = useState(10000);
  const [marketTotal, setMarketTotal] = useState("");
  const [marketSpread, setMarketSpread] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [simulationResults, setSimulationResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const parseNum = (val, def) => {
    if (val === null || val === undefined || val === "") return def;
    const str = String(val);
    const hasPercent = str.includes("%");
    const n = typeof val === "number" ? val : parseFloat(str.replace(/%/g, ""));
    if (isNaN(n)) return def;
    // Only convert to decimal if it has a % sign
    if (hasPercent) {
      return n / 100;
    }
    return n;
  };

  // Helper to parse percentage fields - converts to decimal if needed
  const parsePct = (val, def) => {
    if (val === null || val === undefined || val === "") return def;
    const str = String(val);
    const hasPercent = str.includes("%");
    const n = typeof val === "number" ? val : parseFloat(str.replace(/%/g, ""));
    if (isNaN(n)) return def;
    
    // If has % sign, convert to decimal
    if (hasPercent) {
      return n / 100;
    }
    // If already a decimal (< 1), use as-is
    if (n < 1) {
      return n;
    }
    // If it's a whole number like 43 or 56, assume it's a percentage and convert
    if (n >= 1 && n <= 100) {
      return n / 100;
    }
    return n;
  };

  // Helper to parse DVOA - keeps as whole number (e.g., 15% becomes 15, not 0.15)
  const parseDVOA = (val, def) => {
    if (val === null || val === undefined || val === "") return def;
    const str = String(val);
    const n = typeof val === "number" ? val : parseFloat(str.replace(/%/g, ""));
    if (isNaN(n)) return def;
    // DVOA stays as whole number regardless of % sign
    return n;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus("Reading file…");
    try {
      const text = await file.text();
      const Papa = await import("papaparse");
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });

      if (!parsed.data || parsed.data.length === 0) {
        setUploadStatus("❌ Error: empty CSV");
        return;
      }

      const nextDB = {};
      const names = [];

      parsed.data.forEach((row) => {
        const name = String(row["Team"] || row["team"] || "").trim();
        if (!name) return;
        names.push(name);
        nextDB[name] = { ...row };
      });

      if (names.length === 0) {
        setUploadStatus("❌ Error: No teams found. Make sure CSV has 'Team' column.");
        return;
      }

      setTeamDB(nextDB);
      setTeamList(names.sort());
      setUploadStatus(`✅ Loaded ${names.length} teams`);
      setSimulationResults(null);
    } catch (e) {
      setUploadStatus(`❌ Error: ${e?.message || e}`);
    }
  };

  const projectTeamFromDB = (teamName) => {
    const r = teamDB[teamName] || {};
    return {
      name: teamName,
      // Offense - use parseNum for regular stats, parsePct for rates/percentages
      off_ppd: parseNum(r["Off PPD"], 2.06), // Points per drive - regular number
      off_epa: parseNum(r["Off EPA/play"], 0.022), // EPA - regular number
      off_sr: parsePct(r["Off Success Rate"], 0.43), // Success rate - percentage
      off_xpl: parsePct(r["Off Explosive Rate"], 0.113), // Explosive rate - percentage
      off_rz: parsePct(r["Off Red-Zone TD%"], 0.56), // Red zone % - percentage
      off_3out: parsePct(r["Off 3-Out %"], 0.24), // 3-out % - percentage
      off_penalties: parseNum(r["Off Penalties per Drive"], 0.44), // Penalties - regular number
      off_dvoa: parseDVOA(r["Off DVOA"], 0), // DVOA - whole number (15% = 15)
      off_drives: parseNum(r["Off Drives/G"], 11.6), // Drives - regular number
      // Defense
      def_ppd_allowed: parseNum(r["Def PPD Allowed"], 2.06), // Points per drive - regular number
      def_epa_allowed: parseNum(r["Def EPA/play allowed"], 0.022), // EPA - regular number
      def_sr: parsePct(r["Def Success Rate"], 0.43), // Success rate - percentage
      def_xpl: parsePct(r["Def Explosive Rate"], 0.113), // Explosive rate - percentage
      def_penalties: parseNum(r["DEF Penalties per Drive"], 0.44), // Penalties - regular number
      def_rz: parsePct(r["Def Red Zone TD %"], 0.56), // Red zone % - percentage
      def_3out: parsePct(r["Def 3-Out %"], 0.24), // 3-out % - percentage
      def_dvoa: parseDVOA(r["Def DVOA"], 0), // DVOA - whole number (15% = 15)
      def_drives: parseNum(r["Def Drives/G"], 11.6), // Drives - regular number
      // Additional
      off_to_epa: parseNum(r["Off TO EPA per Drive"], 0), // TO EPA - regular number
      off_fp: parseNum(r["Off Avg Starting FP"], 25), // Field position - regular number (yards)
      no_huddle: parsePct(r["No-Huddle %"], 0), // No-huddle % - percentage
      ed_pass: parsePct(r["Neutral Early-Down Pass %"], 0.5), // Pass % - percentage
      off_plays: parseNum(r["Off Plays/Drive"], 6), // Plays - regular number
      def_plays: parseNum(r["Def Plays/Drive Allowed"], 6), // Plays - regular number
      // HFA removed - will only use slider adjustment
    };
  };

  const zScore = (val, mean, sd) => (val - mean) / sd;

  // Sigmoid function for logistic regression
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // Simulate a single drive outcome: returns {score: 0|3|7, outcome: '3out'|'FG'|'TD'}
  const simulateDrive = (metrics, hfa) => {
    const dm = params.driveModel;
    
    // HFA has two components:
    // 1. Direct logit shift (primary effect): ~0.083 per point of HFA
    const hfa_logit = hfa / 12; // 3-point HFA = 0.25 logit adjustment
    
    // 2. Pace adjustment (handled in drive count calculation)
    // No need to adjust differentials - the logit shift handles skill expression
    
    // Use raw differentials without HFA nudging
    const epa_diff = metrics.epa_diff;
    const sr_diff = metrics.sr_diff;
    const rz_diff = metrics.rz_diff;
    
    // 1. Sample 3-and-out probability
    // Apply HFA logit shift (home team gets advantage, away team gets penalty)
    const logit_3out = 
      dm.threeOut_a0 - 
      dm.threeOut_a1 * epa_diff - 
      dm.threeOut_a2 * sr_diff + 
      dm.threeOut_a3 * metrics.opp_3out_centered - // Centered around league avg
      (metrics.isHome ? hfa_logit : -hfa_logit); // Home advantage → fewer 3-outs
    
    const p_3out = sigmoid(Math.max(-8, Math.min(8, logit_3out)));
    
    // Roll for 3-and-out
    if (Math.random() < p_3out) {
      return { score: 0, outcome: '3out' };
    }
    
    // 2. Drive sustained - now sample TD vs FG vs Empty
    const logit_td = 
      dm.td_b0 + 
      dm.td_b1 * epa_diff + 
      dm.td_b2 * sr_diff + 
      dm.td_b3 * rz_diff +
      metrics.strength_adj + // Better teams → more TDs
      (metrics.isHome ? hfa_logit : -hfa_logit); // Home advantage → more TDs
    
    const p_td_given_sustain = sigmoid(Math.max(-8, Math.min(8, logit_td)));
    
    // Adjust FG probability based on red zone quality
    // Better RZ teams score more TDs, leaving fewer non-TD drives for FGs/empties
    // Worse RZ teams have more failed TD attempts → more FGs and turnovers
    // Keep RZ effect bounded so FGs don't explode or vanish
    const rz_quality_factor = Math.min(1.3, Math.max(0.7, 1 - (rz_diff * 0.5)));
    let p_fg_given_sustain = dm.fg_phi * rz_quality_factor * (1 - p_td_given_sustain);
    // Clamp FG probability to available non-TD mass
    p_fg_given_sustain = Math.max(0, Math.min(1 - p_td_given_sustain, p_fg_given_sustain));
    
    // Roll for outcome (TD, FG, or Empty)
    const r = Math.random();
    if (r < p_td_given_sustain) {
      return { score: 7, outcome: 'TD' };
    } else if (r < p_td_given_sustain + p_fg_given_sustain) {
      return { score: 3, outcome: 'FG' };
    } else {
      return { score: 0, outcome: 'Empty' };
    }
  };

  // Simulate full game with discrete drives
  const simulateGameDiscrete = (homeMetrics, awayMetrics, hfa) => {
    // Total possessions ~ sum of team expectations (keeps league PPD honest)
    let totalDrives = Math.round(homeMetrics.drives + awayMetrics.drives);
    // Keep total drives within a realistic league window so per-team caps are satisfiable
    const MIN_TOTAL = 18, MAX_TOTAL = 30;
    totalDrives = Math.max(MIN_TOTAL, Math.min(MAX_TOTAL, totalDrives));
    
    // Small pace tilt to the faster team (bounded)
    const tilt = Math.max(-0.6, Math.min(0.6, (homeMetrics.drives - awayMetrics.drives) * 0.1));
    let homeDrives = Math.round(totalDrives / 2 + tilt);
    let awayDrives = totalDrives - homeDrives; // preserve total
    
    // Safety bounds with total preservation
    const MIN_D = 9, MAX_D = 15;
    homeDrives = Math.max(MIN_D, Math.min(MAX_D, homeDrives));
    awayDrives = totalDrives - homeDrives;
    if (awayDrives < MIN_D) { awayDrives = MIN_D; homeDrives = totalDrives - awayDrives; }
    if (awayDrives > MAX_D) { awayDrives = MAX_D; homeDrives = totalDrives - awayDrives; }
    
    let homeScore = 0;
    let awayScore = 0;
    
    // Simulate home team's drives
    for (let d = 0; d < homeDrives; d++) {
      const result = simulateDrive(homeMetrics, hfa);
      homeScore += result.score;
    }
    
    // Simulate away team's drives
    for (let d = 0; d < awayDrives; d++) {
      const result = simulateDrive(awayMetrics, hfa);
      awayScore += result.score;
    }
    
    return { homeScore, awayScore };
  };

  const estimateScore = (team, oppDefense, isHome, hfa) => {
    const lg = params.lg;
    const w = params.weights;

    // Offensive metrics (z-scores)
    const z_ppd_o = zScore(team.off_ppd, lg.PPD, lg.PPD_sd);
    const z_epa_o = zScore(team.off_epa, lg.EPA, lg.EPA_sd);
    const z_sr_o = zScore(team.off_sr, lg.SR, lg.SR_sd);
    const z_xpl_o = zScore(team.off_xpl, lg.Xpl, lg.Xpl_sd);
    const z_rz_o = zScore(team.off_rz, lg.RZ, lg.RZ_sd);
    const z_out_o = zScore(team.off_3out, lg.ThreeOut, lg.ThreeOut_sd);

    // Defensive metrics (opponent defense)
    const z_ppd_d = zScore(oppDefense.def_ppd_allowed, lg.PPD, lg.PPD_sd);
    const z_epa_d = zScore(oppDefense.def_epa_allowed, lg.EPA, lg.EPA_sd);
    const z_sr_d = zScore(oppDefense.def_sr, lg.SR, lg.SR_sd);
    const z_xpl_d = zScore(oppDefense.def_xpl, lg.Xpl, lg.Xpl_sd);
    const z_rz_d = zScore(oppDefense.def_rz, lg.RZ, lg.RZ_sd);
    const z_out_d = zScore(oppDefense.def_3out, lg.ThreeOut, lg.ThreeOut_sd);

    // Penalties
    const z_pen_o = zScore(team.off_penalties, lg.Pen, lg.Pen_sd);
    const z_pen_d = zScore(oppDefense.def_penalties, lg.Pen, lg.Pen_sd);

    // Efficiency scores
    const eff_o =
      z_ppd_o * w.PPD +
      z_epa_o * w.EPA +
      z_sr_o * w.SR +
      z_xpl_o * w.Xpl +
      z_rz_o * w.RZ -
      z_out_o * w.ThreeOut_eff;

    const eff_d =
      z_ppd_d * w.PPD +
      z_epa_d * w.EPA +
      z_sr_d * w.SR +          // SR allowed ↑ → offense advantage ↑
      z_xpl_d * w.Xpl +
      z_rz_d * w.RZ +
      (-z_out_d * w.ThreeOut_eff); // 3-out rate ↑ → better defense → offense disadvantage

    // Additional adjustments
    const dvoa_adj = (team.off_dvoa / 100) * w.DVOA_off + (oppDefense.def_dvoa / 100) * w.DVOA_def;
    const to_adj = (team.off_to_epa * w.TO_EPA) / lg.Drives;
    const fp_adj = ((team.off_fp - 25) / 10) * w.FP * 0.1;
    const pen_adj = (-z_pen_o * w.Pen + z_pen_d * w.Pen_def) * 0.05;

    // Net advantage
    const net_adv = (eff_o + eff_d) / 2 + dvoa_adj + to_adj + fp_adj + pen_adj;
    
    // Calculate matchup-specific raw differentials (NOT z-scores)
    const epa_diff = team.off_epa - oppDefense.def_epa_allowed;
    const sr_diff = team.off_sr - oppDefense.def_sr;
    const rz_diff = team.off_rz - oppDefense.def_rz;
    
    // Opponent 3-out rate (centered around league average)
    const opp_3out_centered = oppDefense.def_3out - lg.ThreeOut; // ~0 at league-average
    
    // Apply net advantage as a logit adjustment with soft-shrink
    // Large edges get proportionally smaller bumps to prevent blowouts
    // This wires in DVOA, penalties, turnovers, FP
    const raw_strength = net_adv * 0.12;
    const strength_adj = Math.max(-0.2, Math.min(0.2, raw_strength / (1 + Math.abs(raw_strength))));
    
    // Calculate drives with plays adjustment
    const nh_boost = team.no_huddle * w.NoHuddle * 0.5;
    const ed_adj = (team.ed_pass - 0.5) * w.Pace_EDPass;
    let drives = ((team.off_drives + oppDefense.def_drives) / 2) * (1 + nh_boost + ed_adj);
    
    // Plays adjustment (more plays per drive = slightly more drives overall)
    const plays_avg = (team.off_plays + oppDefense.def_plays) / 2;
    const plays_adj = (plays_avg - 5.5) / 5.5; // ~[-1, +1] scale
    const plays_adj_clamped = Math.max(-0.05, Math.min(0.05, plays_adj * 0.08)); // keep to ±5%
    drives *= (1 + plays_adj_clamped);

    // Apply HFA to drives (keep pace nearly neutral since logit shift does the heavy lifting)
    const hfa_drive_adj = isHome ? 1.01 : 0.99;
    drives *= hfa_drive_adj;
    
    // Return all the metrics needed for discrete drive simulation
    return {
      drives,
      epa_diff,
      sr_diff,
      rz_diff,
      opp_3out_centered,
      strength_adj,
      isHome,
    };
  };

  const runMonteCarloSimulation = () => {
    if (!homeTeam || !awayTeam) {
      alert("Please select both home and away teams");
      return;
    }

    setIsSimulating(true);
    setSimulationResults(null);

    // Small delay to allow UI to update
    setTimeout(() => {
      const homeData = projectTeamFromDB(homeTeam);
      const awayData = projectTeamFromDB(awayTeam);
      
      // Use only the slider adjustment for HFA (no base HFA from database)
      const effectiveHFA = hfaAdjustment;

      // Calculate projections (now returns drive metrics instead of point estimates)
      const homeMetrics = estimateScore(homeData, awayData, true, effectiveHFA);
      const awayMetrics = estimateScore(awayData, homeData, false, effectiveHFA);

      const homeScores = [];
      const awayScores = [];
      const totals = [];
      const spreads = [];

      // Run discrete drive simulations
      for (let i = 0; i < numSimulations; i++) {
        const game = simulateGameDiscrete(homeMetrics, awayMetrics, effectiveHFA);
        
        homeScores.push(game.homeScore);
        awayScores.push(game.awayScore);
        totals.push(game.homeScore + game.awayScore);
        spreads.push(game.homeScore - game.awayScore);
      }

      // Calculate statistics
      const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const median = (arr) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };
      const percentile = (arr, p) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * p);
        return sorted[idx];
      };

      const homeWins = homeScores.filter((s, i) => s > awayScores[i]).length;
      const awayWins = awayScores.filter((s, i) => s > homeScores[i]).length;
      const ties = numSimulations - homeWins - awayWins;

      // Calculate over/under percentages if market total is provided
      let overUnder = null;
      if (marketTotal && !isNaN(parseFloat(marketTotal))) {
        const line = parseFloat(marketTotal);
        // Use epsilon for floating-point safety
        const eps = 1e-9;
        const overs = totals.filter(t => t > line + eps).length;
        const unders = totals.filter(t => t < line - eps).length;
        const pushes = totals.filter(t => Math.abs(t - line) <= eps).length;
        overUnder = {
          line,
          overPct: (overs / numSimulations) * 100,
          underPct: (unders / numSimulations) * 100,
          pushPct: (pushes / numSimulations) * 100,
        };
      }

      // Calculate spread coverage if market spread is provided
      let spreadCoverage = null;
      if (marketSpread && !isNaN(parseFloat(marketSpread))) {
        const line = parseFloat(marketSpread); // From home team's perspective (negative = home favored)
        // spreads array = homeScore - awayScore
        // Examples:
        //   Line = 0: Home covers if they win (spread > 0)
        //   Line = -3: Home must win by 4+ (spread < -3, e.g., -4, -5...)
        //   Line = +3: Home can lose by 2 or less, or win (spread > -3)
        
        // Wait, let me think about this correctly:
        // If LAC is -3 (favored), the line is -3
        // LAC covers if: homeScore - awayScore < -3 (they win by MORE than 3)
        // But that seems backwards...
        
        // Actually, in betting terms:
        // LAC -3 means LAC's score is reduced by 3 for betting purposes
        // LAC covers if: (LAC score - 3) > MIN score
        // Which is: LAC score - MIN score > 3
        // Which is: spread > 3
        
        // So if line is -3 (home favored by 3):
        // Home covers if: spread > Math.abs(line) = spread > 3
        // Away covers if: spread < Math.abs(line) = spread < 3
        
        // Universal formula:
        // Home covers if actual spread beats the line (is more in home's favor)
        // If line is negative (home favored): home covers if spread < line (more negative = bigger home win)
        // If line is positive (away favored): home covers if spread > line (more positive = smaller home loss/bigger home win)
        // Simplified: home covers if spread - line < 0, or spread < line
        
        // Actually simplest way: 
        // Spread line from home perspective. Home covers if actual > line (after accounting for sign)
        // If line = -3: home covers if actual < -3 (wins by 4+)
        // If line = 0: home covers if actual > 0 (wins)
        // If line = +3: home covers if actual > +3 (wins by 4+, or loses by less than... wait this is wrong)
        
        // Let me use the standard definition:
        // Home team's spread = points they're favored/unfavored by
        // Negative = favored, positive = underdog
        // Home covers if they beat the spread: actualMargin + spread > 0
        // Example: Home -3, wins by 4: margin = 4, 4 + (-3) = 1 > 0 ✓ covers
        // Example: Home -3, wins by 3: margin = 3, 3 + (-3) = 0 = push
        // Example: Home -3, wins by 2: margin = 2, 2 + (-3) = -1 < 0 ✗ doesn't cover
        
        // Use epsilon for floating-point safety (defensive against float line inputs)
        const eps = 1e-9;
        const homeCovers = spreads.filter(s => s + line > eps).length;
        const awayCovers = spreads.filter(s => s + line < -eps).length;
        const pushes = spreads.filter(s => Math.abs(s + line) <= eps).length;
        spreadCoverage = {
          line,
          homeCoverPct: (homeCovers / numSimulations) * 100,
          awayCoverPct: (awayCovers / numSimulations) * 100,
          pushPct: (pushes / numSimulations) * 100,
        };
      }

      // Calculate distribution for histogram
      const calculateDistribution = (scores, binSize = 5) => {
        const minScore = Math.floor(Math.min(...scores) / binSize) * binSize;
        const maxScore = Math.ceil(Math.max(...scores) / binSize) * binSize;
        const bins = {};
        
        for (let i = minScore; i <= maxScore; i += binSize) {
          bins[i] = 0;
        }
        
        scores.forEach(score => {
          const bin = Math.floor(score / binSize) * binSize;
          bins[bin] = (bins[bin] || 0) + 1;
        });
        
        return Object.entries(bins)
          .map(([bin, count]) => ({ bin: Number(bin), count, percentage: (count / scores.length) * 100 }))
          .sort((a, b) => a.bin - b.bin);
      };

      setSimulationResults({
        homeTeam,
        awayTeam,
        effectiveHFA,
        numSimulations,
        overUnder,
        spreadCoverage,
        home: {
          mean: mean(homeScores),
          median: median(homeScores),
          min: Math.min(...homeScores),
          max: Math.max(...homeScores),
          p10: percentile(homeScores, 0.1),
          p25: percentile(homeScores, 0.25),
          p75: percentile(homeScores, 0.75),
          p90: percentile(homeScores, 0.9),
          distribution: calculateDistribution(homeScores),
        },
        away: {
          mean: mean(awayScores),
          median: median(awayScores),
          min: Math.min(...awayScores),
          max: Math.max(...awayScores),
          p10: percentile(awayScores, 0.1),
          p25: percentile(awayScores, 0.25),
          p75: percentile(awayScores, 0.75),
          p90: percentile(awayScores, 0.9),
          distribution: calculateDistribution(awayScores),
        },
        total: {
          mean: mean(totals),
          median: median(totals),
          min: Math.min(...totals),
          max: Math.max(...totals),
          p10: percentile(totals, 0.1),
          p25: percentile(totals, 0.25),
          p75: percentile(totals, 0.75),
          p90: percentile(totals, 0.9),
          distribution: calculateDistribution(totals, 5),
        },
        spread: {
          mean: mean(spreads),
          median: median(spreads),
          min: Math.min(...spreads),
          max: Math.max(...spreads),
          p10: percentile(spreads, 0.1),
          p25: percentile(spreads, 0.25),
          p75: percentile(spreads, 0.75),
          p90: percentile(spreads, 0.9),
          distribution: calculateDistribution(spreads, 3),
        },
        winProbabilities: {
          homeWin: (homeWins / numSimulations) * 100,
          awayWin: (awayWins / numSimulations) * 100,
          tie: (ties / numSimulations) * 100,
        },
      });

      setIsSimulating(false);
    }, 100);
  };

  const StatBox = ({ label, value, subtitle }) => (
    <div className="bg-slate-700 p-3 rounded">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  );

  const DistributionChart = ({ distribution, color, maxCount }) => (
    <div className="mt-4 space-y-1">
      {distribution.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-12 text-xs text-slate-400 text-right">{item.bin}</div>
          <div className="flex-1 bg-slate-700 rounded overflow-hidden h-6">
            <div
              className={`h-full ${color} transition-all duration-500 flex items-center justify-end pr-2`}
              style={{ width: `${(item.count / maxCount) * 100}%` }}
            >
              <span className="text-xs font-semibold text-white">{item.percentage.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8 border-b border-slate-700 pb-4">
          <BarChart3 className="w-10 h-10 text-blue-400" />
          <div>
            <h1 className="text-4xl font-bold">NFL Monte Carlo Simulator</h1>
            <p className="text-slate-400 text-sm mt-1">Discrete Drive Model - Natural scoring outcomes (TD/FG/Empty)</p>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6">
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-400" />
            Step 1: Upload Team Database
          </h3>
          <p className="text-sm text-slate-400 mb-4">
            Upload a CSV file with team statistics. Must include a 'Team' column and statistical columns like 'Off PPD', 'Off EPA/play', etc.
          </p>
          <div className="flex items-center gap-4">
            <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 shadow-lg">
              <Upload className="w-5 h-5" />
              Choose CSV File
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            {uploadStatus && (
              <div className={`text-sm px-4 py-2 rounded ${uploadStatus.includes("❌") ? "bg-red-900/30 text-red-300" : "bg-green-900/30 text-green-300"}`}>
                {uploadStatus}
              </div>
            )}
          </div>
        </div>

        {/* Team Selection & Settings */}
        {teamList.length > 0 && (
          <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-400" />
              Step 2: Configure Simulation
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Team Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">Home Team</label>
                <select
                  value={homeTeam}
                  onChange={(e) => setHomeTeam(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select home team...</option>
                  {teamList.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">Away Team</label>
                <select
                  value={awayTeam}
                  onChange={(e) => setAwayTeam(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select away team...</option>
                  {teamList.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* HFA Adjustment */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">
                  Home Field Advantage (HFA)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="-5"
                    max="5"
                    step="0.5"
                    value={hfaAdjustment}
                    onChange={(e) => setHfaAdjustment(parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 w-24 text-center font-bold">
                    {hfaAdjustment > 0 ? '+' : ''}{hfaAdjustment.toFixed(1)}
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Set the home field advantage in points. Positive values favor the home team, negative values favor the away team. Zero = neutral field.
                </p>
              </div>

              {/* Number of Simulations */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">
                  Number of Simulations
                </label>
                <select
                  value={numSimulations}
                  onChange={(e) => setNumSimulations(parseInt(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="1000">1,000 (Fast)</option>
                  <option value="5000">5,000 (Balanced)</option>
                  <option value="10000">10,000 (Accurate)</option>
                  <option value="50000">50,000 (Very Accurate)</option>
                  <option value="100000">100,000 (Maximum)</option>
                </select>
                <p className="text-xs text-slate-400 mt-2">
                  More simulations = more accurate probabilities but slower computation
                </p>
              </div>

              {/* Market Total */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">
                  Market Total (Optional)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={marketTotal}
                  onChange={(e) => setMarketTotal(e.target.value)}
                  placeholder="e.g., 44.5"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">
                  Enter the over/under line to see how often the total goes over vs under
                </p>
              </div>

              {/* Market Spread */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-300">
                  Market Spread (Optional)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={marketSpread}
                  onChange={(e) => setMarketSpread(e.target.value)}
                  placeholder="e.g., -3.5 (home favored)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">
                  Enter the spread (negative if home favored) to see coverage percentages
                </p>
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={runMonteCarloSimulation}
              disabled={!homeTeam || !awayTeam || isSimulating}
              className="mt-6 w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-700 disabled:to-slate-700 px-8 py-4 rounded-lg font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-lg disabled:cursor-not-allowed"
            >
              {isSimulating ? (
                <>
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  Running Simulation...
                </>
              ) : (
                <>
                  <Play className="w-6 h-6" />
                  Run Monte Carlo Simulation
                </>
              )}
            </button>
          </div>
        )}

        {/* Results */}
        {simulationResults && (
          <div className="space-y-6">
            {/* Over/Under Analysis */}
            {simulationResults.overUnder && (
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
            )}

            {/* Spread Coverage Analysis */}
            {simulationResults.spreadCoverage && (
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                  Spread Coverage (Line: {simulationResults.homeTeam} {simulationResults.spreadCoverage.line > 0 ? '+' : ''}{simulationResults.spreadCoverage.line})
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/20 p-4 rounded-lg border border-orange-600/30">
                    <div className="text-sm text-orange-300 mb-1">{simulationResults.homeTeam} Covers</div>
                    <div className="text-3xl font-bold text-orange-400">
                      {simulationResults.spreadCoverage.homeCoverPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-orange-300 mt-1">
                      {Math.round((simulationResults.spreadCoverage.homeCoverPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 p-4 rounded-lg border border-purple-600/30">
                    <div className="text-sm text-purple-300 mb-1">{simulationResults.awayTeam} Covers</div>
                    <div className="text-3xl font-bold text-purple-400">
                      {simulationResults.spreadCoverage.awayCoverPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-purple-300 mt-1">
                      {Math.round((simulationResults.spreadCoverage.awayCoverPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-slate-600/20 to-slate-800/20 p-4 rounded-lg border border-slate-600/30">
                    <div className="text-sm text-slate-300 mb-1">Push</div>
                    <div className="text-3xl font-bold text-slate-400">
                      {simulationResults.spreadCoverage.pushPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-300 mt-1">
                      {Math.round((simulationResults.spreadCoverage.pushPct / 100) * simulationResults.numSimulations).toLocaleString()} times
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Win Probabilities */}
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-green-400" />
                Win Probabilities
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/20 p-4 rounded-lg border border-orange-600/30">
                  <div className="text-sm text-orange-300 mb-1">Home Win ({simulationResults.homeTeam})</div>
                  <div className="text-3xl font-bold text-orange-400">
                    {simulationResults.winProbabilities.homeWin.toFixed(1)}%
                  </div>
                </div>
                <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 p-4 rounded-lg border border-purple-600/30">
                  <div className="text-sm text-purple-300 mb-1">Away Win ({simulationResults.awayTeam})</div>
                  <div className="text-3xl font-bold text-purple-400">
                    {simulationResults.winProbabilities.awayWin.toFixed(1)}%
                  </div>
                </div>
                <div className="bg-gradient-to-br from-slate-600/20 to-slate-800/20 p-4 rounded-lg border border-slate-600/30">
                  <div className="text-sm text-slate-300 mb-1">Tie</div>
                  <div className="text-3xl font-bold text-slate-400">
                    {simulationResults.winProbabilities.tie.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="mt-4 text-sm text-slate-400">
                Based on {simulationResults.numSimulations.toLocaleString()} simulations
                {simulationResults.effectiveHFA !== 0 && (
                  <div className="mt-2 bg-slate-700 p-3 rounded">
                    <div className="font-semibold text-orange-300">
                      HFA Applied: <span className="text-green-400 font-bold">{simulationResults.effectiveHFA > 0 ? '+' : ''}{simulationResults.effectiveHFA.toFixed(1)} pts</span> to {simulationResults.homeTeam}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Score Projections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Home Team */}
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <h4 className="text-lg font-bold mb-4 text-orange-400">{simulationResults.homeTeam} (Home)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Mean" value={simulationResults.home.mean.toFixed(1)} />
                  <StatBox label="Median" value={simulationResults.home.median.toFixed(1)} />
                  <StatBox label="10th %ile" value={simulationResults.home.p10.toFixed(1)} />
                  <StatBox label="90th %ile" value={simulationResults.home.p90.toFixed(1)} />
                  <StatBox label="Min" value={simulationResults.home.min.toFixed(1)} />
                  <StatBox label="Max" value={simulationResults.home.max.toFixed(1)} />
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-300 mb-2">Score Distribution</div>
                  <DistributionChart
                    distribution={simulationResults.home.distribution}
                    color="bg-gradient-to-r from-orange-600 to-orange-500"
                    maxCount={Math.max(...simulationResults.home.distribution.map((d) => d.count))}
                  />
                </div>
              </div>

              {/* Away Team */}
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <h4 className="text-lg font-bold mb-4 text-purple-400">{simulationResults.awayTeam} (Away)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Mean" value={simulationResults.away.mean.toFixed(1)} />
                  <StatBox label="Median" value={simulationResults.away.median.toFixed(1)} />
                  <StatBox label="10th %ile" value={simulationResults.away.p10.toFixed(1)} />
                  <StatBox label="90th %ile" value={simulationResults.away.p90.toFixed(1)} />
                  <StatBox label="Min" value={simulationResults.away.min.toFixed(1)} />
                  <StatBox label="Max" value={simulationResults.away.max.toFixed(1)} />
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-300 mb-2">Score Distribution</div>
                  <DistributionChart
                    distribution={simulationResults.away.distribution}
                    color="bg-gradient-to-r from-purple-600 to-purple-500"
                    maxCount={Math.max(...simulationResults.away.distribution.map((d) => d.count))}
                  />
                </div>
              </div>
            </div>

            {/* Game Totals */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Total Points */}
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <h4 className="text-lg font-bold mb-4 text-blue-400">Total Points</h4>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Mean" value={simulationResults.total.mean.toFixed(1)} />
                  <StatBox label="Median" value={simulationResults.total.median.toFixed(1)} />
                  <StatBox label="10th %ile" value={simulationResults.total.p10.toFixed(1)} />
                  <StatBox label="90th %ile" value={simulationResults.total.p90.toFixed(1)} />
                  <StatBox label="Min" value={simulationResults.total.min.toFixed(1)} />
                  <StatBox label="Max" value={simulationResults.total.max.toFixed(1)} />
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-300 mb-2">Total Distribution</div>
                  <DistributionChart
                    distribution={simulationResults.total.distribution}
                    color="bg-gradient-to-r from-blue-600 to-blue-500"
                    maxCount={Math.max(...simulationResults.total.distribution.map((d) => d.count))}
                  />
                </div>
              </div>

              {/* Spread */}
              <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <h4 className="text-lg font-bold mb-4 text-green-400">Spread (Home - Away)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Mean" value={simulationResults.spread.mean.toFixed(1)} />
                  <StatBox label="Median" value={simulationResults.spread.median.toFixed(1)} />
                  <StatBox label="10th %ile" value={simulationResults.spread.p10.toFixed(1)} />
                  <StatBox label="90th %ile" value={simulationResults.spread.p90.toFixed(1)} />
                  <StatBox label="Min" value={simulationResults.spread.min.toFixed(1)} />
                  <StatBox label="Max" value={simulationResults.spread.max.toFixed(1)} />
                </div>
                <div className="mt-4">
                  <div className="text-sm font-semibold text-slate-300 mb-2">Spread Distribution</div>
                  <DistributionChart
                    distribution={simulationResults.spread.distribution}
                    color="bg-gradient-to-r from-green-600 to-green-500"
                    maxCount={Math.max(...simulationResults.spread.distribution.map((d) => d.count))}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {teamList.length === 0 && (
          <div className="bg-slate-800 p-12 rounded-lg border border-slate-700 text-center">
            <Upload className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Get Started</h3>
            <p className="text-slate-400">Upload your team database CSV to begin running simulations</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MonteCarloSimulator;
