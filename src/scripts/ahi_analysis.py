#!/usr/bin/env python3
"""
AHI (Apnea-Hypopnea Index) Analysis Module
==========================================

This module implements automated detection of apnea and hypopnea events
from polysomnography data (Flow and SpO2 channels) and calculates the AHI score.

Clinical Criteria:
- Apnea: Flow reduction ≥90% from baseline for ≥10 seconds
- Hypopnea: Flow reduction 30-90% from baseline + SpO2 drop ≥3% for ≥10 seconds
- AHI: Total events per hour of sleep

Author: Sleep Analysis System
"""

import numpy as np
import sys
import json
from typing import List, Dict, Tuple, Optional
from scipy import signal
from scipy.ndimage import uniform_filter1d


class AHIAnalyzer:
    """Main class for AHI analysis and event detection."""
    
    def __init__(self, flow_data: np.ndarray, spo2_data: np.ndarray, 
                 flow_sample_rate: float, spo2_sample_rate: float, global_baseline: float = None):
        """
        Initialize the AHI analyzer.
        
        Args:
            flow_data: Flow signal data (numpy array)
            spo2_data: SpO2 signal data (numpy array)
            flow_sample_rate: Sampling rate of flow signal (Hz)
            spo2_sample_rate: Sampling rate of SpO2 signal (Hz)
            global_baseline: Global baseline flow value (optional)
        """
        self.flow_data = np.array(flow_data)
        self.spo2_data = np.array(spo2_data)
        self.flow_sr = flow_sample_rate
        self.spo2_sr = spo2_sample_rate
        self.global_baseline = global_baseline
        
        # Clinical parameters (configurable)
        self.apnea_threshold = 0.1  # 10% of baseline (90% reduction)
        self.hypopnea_min_threshold = 0.3  # 30% of baseline (70% reduction)
        self.hypopnea_max_threshold = 0.7  # 70% of baseline (30% reduction)
        self.spo2_drop_threshold = 3.0  # 3% SpO2 drop
        self.min_event_duration = 10.0  # 10 seconds minimum
        
        print(f"[AHI] Initialized with Flow: {len(flow_data)} samples @ {flow_sample_rate}Hz", file=sys.stderr)
        print(f"[AHI] SpO2: {len(spo2_data)} samples @ {spo2_sample_rate}Hz", file=sys.stderr)
        print(f"[AHI] Flow data range: {np.min(flow_data):.3f} to {np.max(flow_data):.3f}", file=sys.stderr)
        print(f"[AHI] SpO2 data range: {np.min(spo2_data):.3f} to {np.max(spo2_data):.3f}", file=sys.stderr)
    
    def calculate_baseline_flow(self, window_minutes: int = 5) -> float:
        """
        Calculate baseline flow using a rolling median approach.
        
        Args:
            window_minutes: Window size in minutes for baseline calculation
            
        Returns:
            Baseline flow value
        """
        # Use global baseline if provided (from chunked analysis)
        if self.global_baseline is not None:
            print(f"[AHI] Using global baseline: {self.global_baseline:.3f}", file=sys.stderr)
            return self.global_baseline
        
        # Otherwise calculate local baseline
        window_samples = int(window_minutes * 60 * self.flow_sr)
        
        # Use median of upper 50% of values to avoid including apneas in baseline
        flow_abs = np.abs(self.flow_data)
        upper_50_percentile = np.percentile(flow_abs, 50)
        baseline_candidates = flow_abs[flow_abs >= upper_50_percentile]
        baseline = np.median(baseline_candidates)
        
        print(f"[AHI] Calculated local baseline flow: {baseline:.3f}", file=sys.stderr)
        return baseline
    
    def detect_apnea_events(self) -> List[Dict]:
        """
        Detect apnea events (flow cessation ≥90% reduction).
        
        Returns:
            List of apnea events with start_time, end_time, duration
        """
        baseline = self.calculate_baseline_flow()
        threshold = baseline * self.apnea_threshold
        
        print(f"[AHI] Apnea detection - Baseline: {baseline:.3f}, Threshold: {threshold:.3f} ({self.apnea_threshold*100:.0f}% of baseline)", file=sys.stderr)
        
        # Smooth the signal to reduce noise
        # Calculate appropriate filter size (at least 1, and reasonable for the sample rate)
        filter_size = max(1, int(self.flow_sr * 2))  # 2-second window minimum
        if filter_size >= len(self.flow_data):
            filter_size = max(1, len(self.flow_data) // 4)  # Use 1/4 of data length if too large
        
        print(f"[AHI] Using filter size: {filter_size} for flow smoothing", file=sys.stderr)
        flow_smooth = uniform_filter1d(np.abs(self.flow_data), size=filter_size)
        
        # Find regions below threshold
        below_threshold = flow_smooth < threshold
        below_count = np.sum(below_threshold)
        print(f"[AHI] Found {below_count} samples below threshold ({below_count/self.flow_sr:.1f}s total)", file=sys.stderr)
        
        # Find continuous regions
        events = []
        in_event = False
        event_start = 0
        
        for i, is_below in enumerate(below_threshold):
            if is_below and not in_event:
                # Start of potential event
                in_event = True
                event_start = i
            elif not is_below and in_event:
                # End of event
                in_event = False
                event_end = i
                duration = (event_end - event_start) / self.flow_sr
                
                # Check if event meets minimum duration
                if duration >= self.min_event_duration:
                    events.append({
                        'type': 'apnea',
                        'start_sample': event_start,
                        'end_sample': event_end,
                        'start_time': event_start / self.flow_sr,
                        'end_time': event_end / self.flow_sr,
                        'duration': duration,
                        'severity': 'severe' if duration > 30 else 'moderate'
                    })
        
        # Handle case where recording ends during an event
        if in_event:
            event_end = len(below_threshold)
            duration = (event_end - event_start) / self.flow_sr
            if duration >= self.min_event_duration:
                events.append({
                    'type': 'apnea',
                    'start_sample': event_start,
                    'end_sample': event_end,
                    'start_time': event_start / self.flow_sr,
                    'end_time': event_end / self.flow_sr,
                    'duration': duration,
                    'severity': 'severe' if duration > 30 else 'moderate'
                })
        
        print(f"[AHI] Detected {len(events)} apnea events", file=sys.stderr)
        return events
    
    def detect_hypopnea_events(self) -> List[Dict]:
        """
        Detect hypopnea events (flow reduction 30-90% + SpO2 drop ≥3%).
        
        Returns:
            List of hypopnea events with start_time, end_time, duration, spo2_drop
        """
        baseline = self.calculate_baseline_flow()
        min_threshold = baseline * self.hypopnea_min_threshold
        max_threshold = baseline * self.hypopnea_max_threshold
        
        # Smooth signals with robust filter size calculation
        # Flow signal smoothing
        flow_filter_size = max(1, int(self.flow_sr * 2))  # 2-second window minimum
        if flow_filter_size >= len(self.flow_data):
            flow_filter_size = max(1, len(self.flow_data) // 4)
        
        # SpO2 signal smoothing  
        spo2_filter_size = max(1, int(self.spo2_sr * 3))  # 3-second window minimum
        if spo2_filter_size >= len(self.spo2_data):
            spo2_filter_size = max(1, len(self.spo2_data) // 4)
            
        print(f"[AHI] Using filter sizes - Flow: {flow_filter_size}, SpO2: {spo2_filter_size}", file=sys.stderr)
        
        flow_smooth = uniform_filter1d(np.abs(self.flow_data), size=flow_filter_size)
        spo2_smooth = uniform_filter1d(self.spo2_data, size=spo2_filter_size)
        
        # Find flow reduction regions (between 30-70% of baseline)
        flow_reduced = (flow_smooth >= min_threshold) & (flow_smooth <= max_threshold)
        
        # Find continuous flow reduction regions
        potential_events = []
        in_event = False
        event_start = 0
        
        for i, is_reduced in enumerate(flow_reduced):
            if is_reduced and not in_event:
                in_event = True
                event_start = i
            elif not is_reduced and in_event:
                in_event = False
                event_end = i
                duration = (event_end - event_start) / self.flow_sr
                
                if duration >= self.min_event_duration:
                    potential_events.append({
                        'start_sample': event_start,
                        'end_sample': event_end,
                        'start_time': event_start / self.flow_sr,
                        'end_time': event_end / self.flow_sr,
                        'duration': duration
                    })
        
        # Handle case where recording ends during an event
        if in_event:
            event_end = len(flow_reduced)
            duration = (event_end - event_start) / self.flow_sr
            if duration >= self.min_event_duration:
                potential_events.append({
                    'start_sample': event_start,
                    'end_sample': event_end,
                    'start_time': event_start / self.flow_sr,
                    'end_time': event_end / self.flow_sr,
                    'duration': duration
                })
        
        # Check for corresponding SpO2 drops
        hypopnea_events = []
        
        for event in potential_events:
            # Convert flow time to SpO2 samples
            spo2_start = int(event['start_time'] * self.spo2_sr)
            spo2_end = int(event['end_time'] * self.spo2_sr)
            
            # Ensure we don't go out of bounds
            spo2_start = max(0, spo2_start)
            spo2_end = min(len(spo2_smooth), spo2_end)
            
            if spo2_end <= spo2_start:
                continue
            
            # Look for SpO2 drop during the event (with some margin)
            pre_event_start = max(0, spo2_start - int(30 * self.spo2_sr))  # 30s before
            baseline_spo2 = np.median(spo2_smooth[pre_event_start:spo2_start])
            
            # Find minimum SpO2 during event and shortly after
            post_event_end = min(len(spo2_smooth), spo2_end + int(30 * self.spo2_sr))  # 30s after
            min_spo2 = np.min(spo2_smooth[spo2_start:post_event_end])
            
            spo2_drop = baseline_spo2 - min_spo2
            
            # Check if SpO2 drop meets criteria
            if spo2_drop >= self.spo2_drop_threshold:
                hypopnea_events.append({
                    'type': 'hypopnea',
                    'start_sample': event['start_sample'],
                    'end_sample': event['end_sample'],
                    'start_time': event['start_time'],
                    'end_time': event['end_time'],
                    'duration': event['duration'],
                    'spo2_drop': spo2_drop,
                    'baseline_spo2': baseline_spo2,
                    'min_spo2': min_spo2,
                    'severity': 'severe' if spo2_drop > 6 else 'moderate'
                })
        
        print(f"[AHI] Detected {len(hypopnea_events)} hypopnea events from {len(potential_events)} flow reductions", file=sys.stderr)
        return hypopnea_events
    
    def calculate_ahi(self, apnea_events: List[Dict], hypopnea_events: List[Dict], 
                     recording_duration_hours: float) -> Dict:
        """
        Calculate AHI score and classify severity.
        
        Args:
            apnea_events: List of detected apnea events
            hypopnea_events: List of detected hypopnea events  
            recording_duration_hours: Total recording duration in hours
            
        Returns:
            Dictionary with AHI score, severity, and event statistics
        """
        total_events = len(apnea_events) + len(hypopnea_events)
        ahi_score = total_events / recording_duration_hours if recording_duration_hours > 0 else 0
        
        # Classify severity according to clinical standards
        if ahi_score < 5:
            severity = "Normal"
            severity_color = "green"
        elif ahi_score < 15:
            severity = "Mild"
            severity_color = "yellow"
        elif ahi_score < 30:
            severity = "Moderate"
            severity_color = "orange"
        else:
            severity = "Severe"
            severity_color = "red"
        
        # Calculate additional statistics
        total_apnea_duration = sum(event['duration'] for event in apnea_events)
        total_hypopnea_duration = sum(event['duration'] for event in hypopnea_events)
        total_event_duration = total_apnea_duration + total_hypopnea_duration
        
        avg_apnea_duration = total_apnea_duration / len(apnea_events) if apnea_events else 0
        avg_hypopnea_duration = total_hypopnea_duration / len(hypopnea_events) if hypopnea_events else 0
        
        result = {
            'ahi_score': round(ahi_score, 1),
            'severity': severity,
            'severity_color': severity_color,
            'total_events': total_events,
            'apnea_count': len(apnea_events),
            'hypopnea_count': len(hypopnea_events),
            'recording_duration_hours': round(recording_duration_hours, 2),
            'total_event_duration_minutes': round(total_event_duration / 60, 1),
            'event_percentage': round((total_event_duration / (recording_duration_hours * 3600)) * 100, 1),
            'avg_apnea_duration': round(avg_apnea_duration, 1),
            'avg_hypopnea_duration': round(avg_hypopnea_duration, 1),
            'events_per_hour_breakdown': {
                'apnea_per_hour': round(len(apnea_events) / recording_duration_hours, 1),
                'hypopnea_per_hour': round(len(hypopnea_events) / recording_duration_hours, 1)
            }
        }
        
        print(f"[AHI] Analysis complete: AHI={ahi_score:.1f} ({severity})", file=sys.stderr)
        print(f"[AHI] Events: {len(apnea_events)} apneas, {len(hypopnea_events)} hypopneas", file=sys.stderr)
        
        return result
    
    def analyze(self) -> Dict:
        """
        Perform complete AHI analysis.
        
        Returns:
            Complete analysis results including events and statistics
        """
        print("[AHI] Starting AHI analysis...", file=sys.stderr)
        
        # Calculate recording duration
        flow_duration_hours = len(self.flow_data) / (self.flow_sr * 3600)
        spo2_duration_hours = len(self.spo2_data) / (self.spo2_sr * 3600)
        recording_duration_hours = min(flow_duration_hours, spo2_duration_hours)
        
        print(f"[AHI] Recording duration: {recording_duration_hours:.2f} hours", file=sys.stderr)
        
        # Detect events
        apnea_events = self.detect_apnea_events()
        hypopnea_events = self.detect_hypopnea_events()
        
        # Calculate AHI
        ahi_results = self.calculate_ahi(apnea_events, hypopnea_events, recording_duration_hours)
        
        # Combine all results
        results = {
            'ahi_analysis': ahi_results,
            'apnea_events': apnea_events,
            'hypopnea_events': hypopnea_events,
            'all_events': sorted(apnea_events + hypopnea_events, key=lambda x: x['start_time']),
            'analysis_parameters': {
                'apnea_threshold': self.apnea_threshold,
                'hypopnea_min_threshold': self.hypopnea_min_threshold,
                'hypopnea_max_threshold': self.hypopnea_max_threshold,
                'spo2_drop_threshold': self.spo2_drop_threshold,
                'min_event_duration': self.min_event_duration
            }
        }
        
        print(f"[AHI] Analysis completed successfully", file=sys.stderr)
        return results


def main():
    """Main function for command-line usage."""
    if len(sys.argv) != 2:
        print("Usage: python ahi_analysis.py '<json_file_path>'", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Read input JSON from file (avoids PowerShell escaping issues)
        json_file_path = sys.argv[1]
        with open(json_file_path, 'r') as f:
            input_data = json.load(f)
        
        # Extract required data
        flow_data = input_data['flow_data']
        spo2_data = input_data['spo2_data']
        flow_sample_rate = input_data['flow_sample_rate']
        spo2_sample_rate = input_data['spo2_sample_rate']
        global_baseline = input_data.get('global_baseline', None)
        
        # Create analyzer and run analysis
        analyzer = AHIAnalyzer(flow_data, spo2_data, flow_sample_rate, spo2_sample_rate, global_baseline)
        results = analyzer.analyze()
        
        # Output results as JSON
        print(json.dumps(results))
        
    except Exception as e:
        print(f"[ERROR] AHI analysis failed: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
