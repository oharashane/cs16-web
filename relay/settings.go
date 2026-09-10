package main

// The settings the page offers: which game, which map, and the handful of knobs worth
// having on a family server. They are written into the mode's own .cfg — which amxx.cfg
// re-runs on every map load — so a choice survives a map change and a restart, which is
// what "leave it like that" has to mean.

import (
	"encoding/json"
	"net/http"
)

type settingsBody struct {
	Mode     string `json:"mode"`
	Map      string `json:"map"`
	Gravity  int    `json:"gravity"`
	Bhop     bool   `json:"bhop"`
	MaxFunds bool   `json:"maxFunds"`
}

type settingsReply struct {
	Modes     []Mode       `json:"modes"`
	Gravities []int        `json:"gravities"`
	Current   settingsBody `json:"current"`
	PlayingOn string       `json:"playingOn"`
	Applied   string       `json:"applied,omitempty"`
	Problem   string       `json:"problem,omitempty"`
}

func settingsHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		modes, err := readModes(cfg.ModesDir)
		if err != nil {
			http.Error(w, "cannot read the modes: "+err.Error(), http.StatusInternalServerError)
			return
		}
		reply := settingsReply{Modes: modes, Gravities: gravities}

		if r.Method == http.MethodPost {
			var want settingsBody
			if err := json.NewDecoder(r.Body).Decode(&want); err != nil {
				reply.Problem = "that was not a settings message"
			} else {
				message, problem := apply(cfg, modes, adminView{
					Mode: want.Mode, Map: want.Map, Gravity: want.Gravity,
					Bhop: want.Bhop, MaxFunds: want.MaxFunds,
				})
				reply.Applied, reply.Problem = message, problem
			}
		}

		mode, gravity, bhop, maxFunds := currentSettings(cfg.ModesDir, modes)
		reply.Current = settingsBody{Mode: mode, Gravity: gravity, Bhop: bhop, MaxFunds: maxFunds}
		reply.PlayingOn = currentMap(cfg)
		reply.Current.Map = reply.PlayingOn
		writeJSON(w, reply)
	}
}
