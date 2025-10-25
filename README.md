# NFL Monte Carlo Simulator - Discrete Drive Model

A sophisticated NFL game simulator using discrete drive-by-drive modeling for realistic score projections.

## Features

- **Discrete Drive Model**: Simulates each drive as TD/FG/Empty for realistic NFL scores
- **Matchup-Specific Variance**: Variance emerges naturally from team strengths
- **Key Number Clustering**: Proper weight to scores like 3, 7, 10, 14, 17
- **Market Analysis**: Compare projections against sportsbook lines
- **Beautiful UI**: Modern dark theme with interactive visualizations

## Tech Stack

- React 18
- Vite
- Tailwind CSS
- Lucide React (icons)
- PapaParse (CSV parsing)

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/nfl-monte-carlo-simulator.git
cd nfl-monte-carlo-simulator
```

2. Install dependencies:
```bash
npm install
```

3. Run development server:
```bash
npm run dev
```

4. Open http://localhost:5173 in your browser

## Deployment to Vercel

### Option 1: Deploy from GitHub (Recommended)

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Vercel auto-detects Vite config
6. Click "Deploy"

### Option 2: Deploy with Vercel CLI

```bash
npm install -g vercel
vercel
```

## Usage

1. **Upload CSV**: Prepare a CSV with team statistics including columns like:
   - Team
   - Off PPD, Off EPA/play, Off Success Rate, Off Explosive Rate, Off Red-Zone TD%, Off 3-Out %
   - Def PPD Allowed, Def EPA/play allowed, Def Success Rate, Def Explosive Rate, Def Red Zone TD %, Def 3-Out %, Def DVOA

2. **Select Teams**: Choose home and away teams from dropdowns

3. **Adjust HFA**: Use slider to set home field advantage (-5 to +5 points)

4. **Enter Market Lines** (optional): Input sportsbook total and spread for edge analysis

5. **Run Simulation**: Click "Run Simulation" to generate 10,000 Monte Carlo iterations

6. **Analyze Results**: View win probabilities, score distributions, and market edges

## Model Details

The discrete drive model uses logistic regression to simulate each drive:

### 3-and-Out Probability:
```
p_3out = σ(a0 - a1·EPA_net - a2·SR_net + a3·Opp_3Out + a4·RZ_bad)
```

### TD Probability (given sustained drive):
```
p_TD = σ(b0 + b1·EPA_net + b2·SR_net + b3·RZ_net + b4·PPD_resid)
```

### FG Probability (given sustained drive):
```
p_FG = φ · (1 - p_TD)
```

Pre-calibrated to NFL averages:
- 3-and-out rate: ~24%
- TD rate: ~24% of sustained drives
- FG rate: ~18% of sustained drives
- Average PPD: ~2.0

## License

MIT

## Author

Built with ❤️ for NFL analytics and sports betting
