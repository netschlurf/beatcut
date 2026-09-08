#include "beatcut/audio.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace beatcut {
namespace {

struct Wav {
    int sr = 0;
    std::vector<float> mono;
};

uint16_t u16(const unsigned char* p) {
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}
uint32_t u32(const unsigned char* p) {
    return static_cast<uint32_t>(p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24));
}
int16_t i16(const unsigned char* p) {
    return static_cast<int16_t>(u16(p));
}

Wav load_wav(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot open wav: " + path);
    std::vector<unsigned char> buf((std::istreambuf_iterator<char>(f)), {});
    if (buf.size() < 44) throw std::runtime_error("wav too small");
    if (std::string(buf.begin(), buf.begin() + 4) != "RIFF")
        throw std::runtime_error("not RIFF");

    size_t pos = 12;
    int sr = 0, ch = 0, bps = 0;
    size_t data_off = 0, data_sz = 0;
    while (pos + 8 <= buf.size()) {
        std::string id(reinterpret_cast<char*>(&buf[pos]), 4);
        uint32_t sz = u32(&buf[pos + 4]);
        pos += 8;
        if (pos + sz > buf.size()) break;
        if (id == "fmt ") {
            ch = u16(&buf[pos + 2]);
            sr = static_cast<int>(u32(&buf[pos + 4]));
            bps = u16(&buf[pos + 14]);
        } else if (id == "data") {
            data_off = pos;
            data_sz = sz;
        }
        pos += sz + (sz & 1);
    }
    if (!sr || !ch || !data_off) throw std::runtime_error("bad wav fmt/data");
    if (bps != 16) throw std::runtime_error("only PCM16 wav supported");

    const size_t nframes = data_sz / (static_cast<size_t>(ch) * 2);
    std::vector<float> mono(nframes);
    const unsigned char* p = &buf[data_off];
    for (size_t i = 0; i < nframes; ++i) {
        double acc = 0;
        for (int c = 0; c < ch; ++c) {
            acc += static_cast<double>(i16(p)) / 32768.0;
            p += 2;
        }
        mono[i] = static_cast<float>(acc / ch);
    }
    return {sr, std::move(mono)};
}

std::vector<float> resample_linear(const std::vector<float>& x, int sr_in, int sr_out) {
    if (sr_in == sr_out) return x;
    const double ratio = static_cast<double>(sr_out) / sr_in;
    const size_t n = static_cast<size_t>(std::max(1.0, std::floor(x.size() * ratio)));
    std::vector<float> y(n);
    for (size_t i = 0; i < n; ++i) {
        const double src = i / ratio;
        const size_t i0 = static_cast<size_t>(src);
        const size_t i1 = std::min(i0 + 1, x.size() - 1);
        const double t = src - i0;
        y[i] = static_cast<float>(x[i0] * (1.0 - t) + x[i1] * t);
    }
    return y;
}

void rms_curve(const std::vector<float>& y, int sr, int hop, int frame,
               std::vector<double>& times, std::vector<double>& norm) {
    if (y.size() < static_cast<size_t>(frame)) {
        times = {0};
        double e = 0;
        for (float v : y) e += v * v;
        norm = {std::sqrt(e / std::max<size_t>(1, y.size()) + 1e-12)};
        return;
    }
    const size_t n = (y.size() - frame) / hop + 1;
    std::vector<double> rms(n);
    times.resize(n);
    for (size_t i = 0; i < n; ++i) {
        double acc = 0;
        const size_t s = i * hop;
        for (int k = 0; k < frame; ++k) acc += y[s + k] * y[s + k];
        rms[i] = std::sqrt(acc / frame + 1e-12);
        times[i] = static_cast<double>(s) / sr;
    }
    auto tmp = rms;
    std::sort(tmp.begin(), tmp.end());
    const double lo = tmp[static_cast<size_t>(0.05 * (tmp.size() - 1))];
    const double hi = tmp[static_cast<size_t>(0.95 * (tmp.size() - 1))];
    norm.resize(n);
    for (size_t i = 0; i < n; ++i)
        norm[i] = std::clamp((rms[i] - lo) / (hi - lo + 1e-9), 0.0, 1.0);
}

void hann(std::vector<double>& w) {
    const int n = static_cast<int>(w.size());
    for (int i = 0; i < n; ++i) w[i] = 0.5 - 0.5 * std::cos(2.0 * M_PI * i / (n - 1));
}

// naive real DFT magnitude for nperseg bins (only needed flux, so we can use
// a coarse banded energy). Use Goertzel-free STFT via direct DFT on each frame
// is too slow. Use sum of |diff| on windowed FFT via recursive? Keep it simple:
// compute magnitude of 64 mel-ish bands via squared bins of a small DFT.
void stft_mags(const std::vector<float>& y, int hop, int nfft,
               std::vector<std::vector<double>>& mags) {
    std::vector<double> win(nfft);
    hann(win);
    const size_t nframes = y.size() >= static_cast<size_t>(nfft)
                               ? (y.size() - nfft) / hop + 1
                               : 0;
    const int nbins = nfft / 2;
    mags.assign(nframes, std::vector<double>(nbins, 0.0));
    std::vector<double> re(nbins), im(nbins);
    for (size_t f = 0; f < nframes; ++f) {
        const size_t off = f * hop;
        std::fill(re.begin(), re.end(), 0.0);
        std::fill(im.begin(), im.end(), 0.0);
        // DFT only first nbins using Goertzel-like accumulation
        for (int k = 0; k < nbins; ++k) {
            double r = 0, i = 0;
            const double wr = std::cos(-2.0 * M_PI * k / nfft);
            const double wi = std::sin(-2.0 * M_PI * k / nfft);
            double cr = 1, ci = 0;
            for (int n = 0; n < nfft; ++n) {
                const double v = y[off + n] * win[n];
                r += v * cr;
                i += v * ci;
                const double nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
            mags[f][k] = std::sqrt(r * r + i * i);
        }
    }
}

std::vector<double> spectral_flux(const std::vector<std::vector<double>>& mags) {
    std::vector<double> flux(mags.size(), 0.0);
    for (size_t i = 1; i < mags.size(); ++i) {
        double s = 0;
        for (size_t k = 0; k < mags[i].size(); ++k) {
            const double d = mags[i][k] - mags[i - 1][k];
            if (d > 0) s += d;
        }
        flux[i] = s;
    }
    // light smoothing
    if (flux.size() >= 3) {
        std::vector<double> sm(flux.size());
        sm[0] = flux[0];
        sm.back() = flux.back();
        for (size_t i = 1; i + 1 < flux.size(); ++i)
            sm[i] = 0.25 * flux[i - 1] + 0.5 * flux[i] + 0.25 * flux[i + 1];
        flux.swap(sm);
    }
    return flux;
}

}  // namespace

AudioAnalysis analyze_wav(const std::string& path) {
    Wav wav = load_wav(path);
    const int target_sr = 22050;
    auto y = resample_linear(wav.mono, wav.sr, target_sr);
    AudioAnalysis out;
    out.path = path;
    out.sample_rate = target_sr;
    out.duration = static_cast<double>(y.size()) / target_sr;

    const int hop = 512;
    const int frame = 2048;
    std::vector<double> e_t, e_v;
    rms_curve(y, target_sr, hop, frame, e_t, e_v);

    // Smaller FFT for speed on long files still ok for 16s clicks.
    const int nfft = 1024;
    std::vector<std::vector<double>> mags;
    stft_mags(y, hop, nfft, mags);
    auto flux = spectral_flux(mags);

    std::vector<double> env(flux.size(), 0);
    const int win = 16;
    for (size_t i = 0; i < flux.size(); ++i) {
        double mx = 0;
        const size_t a = i > static_cast<size_t>(win) ? i - win : 0;
        const size_t b = std::min(flux.size(), i + win + 1);
        for (size_t j = a; j < b; ++j) mx = std::max(mx, flux[j]);
        env[i] = mx;
    }
    double med = 0;
    if (!flux.empty()) {
        auto tmp = flux;
        std::nth_element(tmp.begin(), tmp.begin() + tmp.size() / 2, tmp.end());
        med = tmp[tmp.size() / 2];
    }

    // Estimate the dominant beat period via autocorrelation of the onset envelope.
    // Naive local-max picking alone fires on every transient (hi-hats, vocals,
    // harmonics) in dense real-world music, not just the beat; locking to the
    // strongest periodicity avoids that over-detection.
    const double hop_time = static_cast<double>(hop) / target_sr;
    const double bpm_lo = 60.0, bpm_hi = 200.0;
    const int min_lag = std::max(1, static_cast<int>(std::round((60.0 / bpm_hi) / hop_time)));
    const int max_lag = static_cast<int>(std::round((60.0 / bpm_lo) / hop_time));
    int period_frames = 0;
    if (static_cast<int>(flux.size()) > 2 * max_lag) {
        double mean = 0;
        for (double v : flux) mean += v;
        mean /= flux.size();
        std::vector<double> corr(max_lag + 1, -1e18);
        double best_corr = -1e18;
        for (int lag = min_lag; lag <= max_lag; ++lag) {
            double c = 0;
            const size_t n = flux.size() - lag;
            for (size_t i = 0; i < n; ++i) c += (flux[i] - mean) * (flux[i + lag] - mean);
            // biased normalization (divide by total length, not overlap count) so
            // longer lags with fewer overlapping samples don't spuriously outscore
            // the true, shorter period due to lower variance from less averaging
            c /= flux.size();
            corr[lag] = c;
            best_corr = std::max(best_corr, c);
        }
        // autocorrelation is roughly as strong at integer multiples of the true
        // period (octave ambiguity, sometimes even stronger than the fundamental).
        // Starting from the global peak, repeatedly try halving the period and
        // keep the half if it still correlates almost as strongly, converging on
        // the fundamental beat instead of a slower multiple of it.
        int chosen = min_lag;
        for (int lag = min_lag; lag <= max_lag; ++lag) {
            if (corr[lag] > corr[chosen]) chosen = lag;
        }
        for (;;) {
            const int half_lo = chosen / 2;
            const int half_hi = (chosen + 1) / 2;
            int cand = -1;
            if (half_lo >= min_lag && (cand < 0 || corr[half_lo] > corr[cand])) cand = half_lo;
            if (half_hi >= min_lag && half_hi != half_lo && (cand < 0 || corr[half_hi] > corr[cand])) cand = half_hi;
            if (cand < 0 || corr[cand] < 0.6 * corr[chosen]) break;
            chosen = cand;
        }
        period_frames = chosen;
        if (std::getenv("BEATCUT_DEBUG")) {
            std::cerr << "tempo debug: min_lag=" << min_lag << " max_lag=" << max_lag
                      << " period_frames=" << period_frames << " best_corr=" << best_corr
                      << " period_sec=" << period_frames * hop_time
                      << " bpm=" << 60.0 / (period_frames * hop_time) << "\n";
            for (int lag = min_lag; lag <= max_lag; ++lag)
                std::cerr << "  lag=" << lag << " corr=" << corr[lag] << " bpm=" << 60.0 / (lag * hop_time) << "\n";
        }
    }

    std::vector<int> peaks;
    if (period_frames > 0) {
        // phase-locked: keep only the strongest onset within each beat-length
        // window, trying a few phase offsets and keeping the best-scoring one
        const int tries = 8;
        double best_score = -1e18;
        std::vector<int> best_sel;
        for (int t = 0; t < tries; ++t) {
            const int phase = static_cast<int>(std::round((static_cast<double>(t) / tries) * period_frames));
            std::vector<int> sel;
            double score = 0;
            for (int idx = phase; idx + 1 < static_cast<int>(flux.size()); idx += period_frames) {
                const int wend = std::min(static_cast<int>(flux.size()) - 1, idx + period_frames);
                int best_j = idx;
                double best_v = flux[idx];
                for (int j = idx + 1; j < wend; ++j) {
                    if (flux[j] > best_v) {
                        best_v = flux[j];
                        best_j = j;
                    }
                }
                if (best_v >= 0.12 * med) {
                    sel.push_back(best_j);
                    score += best_v;
                }
            }
            if (score > best_score) {
                best_score = score;
                best_sel = sel;
            }
        }
        peaks = best_sel;
    } else {
        // fallback for clips too short for a reliable tempo estimate
        const int min_gap = std::max(1, static_cast<int>(0.22 * target_sr / hop));
        int last = -min_gap;
        for (size_t i = 1; i + 1 < flux.size(); ++i) {
            const double thr = 0.35 * env[i] + 0.12 * med;
            if (flux[i] >= thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
                if (static_cast<int>(i) - last >= min_gap) {
                    peaks.push_back(static_cast<int>(i));
                    last = static_cast<int>(i);
                }
            }
        }
    }

    auto energy_at = [&](double t) {
        if (e_t.empty()) return 0.0;
        size_t i = 0;
        while (i + 1 < e_t.size() && e_t[i + 1] <= t) ++i;
        return e_v[i];
    };

    double fmin = 1e9, fmax = 0;
    for (double v : flux) {
        fmin = std::min(fmin, v);
        fmax = std::max(fmax, v);
    }

    for (int idx : peaks) {
        Beat b;
        b.t = static_cast<double>(idx * hop) / target_sr;
        if (b.t < 0 || b.t > out.duration) continue;
        b.index = static_cast<int>(out.beats.size());
        b.strength = (fmax > fmin) ? std::clamp((flux[idx] - fmin) / (fmax - fmin), 0.0, 1.0) : 0;
        const double e = energy_at(b.t);
        b.energy = 0.55 * e + 0.45 * b.strength;
        out.beats.push_back(b);
    }

    if (out.beats.size() >= 4) {
        std::vector<double> ibi;
        for (size_t i = 1; i < out.beats.size(); ++i) {
            if (out.beats[i - 1].t < 0.12) continue;
            const double d = out.beats[i].t - out.beats[i - 1].t;
            if (d > 0.28 && d < 1.05) ibi.push_back(d);
        }
        if (out.beats.size() >= 4) {
            const double span = out.beats.back().t - out.beats.front().t;
            if (span > 0.5) {
                out.bpm_estimate = 60.0 * (out.beats.size() - 1) / span;
                out.has_bpm = true;
            }
        } else if (!ibi.empty()) {
            std::nth_element(ibi.begin(), ibi.begin() + ibi.size() / 2, ibi.end());
            out.bpm_estimate = 60.0 / ibi[ibi.size() / 2];
            out.has_bpm = true;
        }
    }
    return out;
}

}  // namespace beatcut
