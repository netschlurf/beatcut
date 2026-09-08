#pragma once
#include <string>
#include <vector>

namespace beatcut {

struct Beat {
    double t = 0;
    int index = 0;
    double energy = 0;
    double strength = 0;
};

struct AudioAnalysis {
    std::string path;
    double duration = 0;
    int sample_rate = 0;
    double bpm_estimate = 0;
    bool has_bpm = false;
    std::vector<Beat> beats;
};

AudioAnalysis analyze_wav(const std::string& path);

}  // namespace beatcut
