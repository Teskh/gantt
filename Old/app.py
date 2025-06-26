from flask import Flask, render_template, jsonify, request
import pandas as pd
from datetime import date, timedelta, datetime
from dataclasses import dataclass

app = Flask(__name__)

START_YEAR = 2025
START_MONTH = 1 # January (Python's datetime uses 1-12)
START_DAY = 1   # 1st
START_DATE = date(START_YEAR, START_MONTH, START_DAY)
DEFAULT_CAPACITY = 450
COMPLEXITY_BASE = 4.5

@dataclass
class MonthLabel:
    month: int
    year: int
    start_week: int
    week_count: int

@dataclass
class QuarterInfo:
    quarter: int
    year: int
    start_week: int
    week_count: int

def get_date_for_week(week_number):
    """Calculates the start date of a given week number (week 1 is the first week)."""
    # Week 1 starts on START_DATE, so add (week_number - 1) weeks.
    return START_DATE + timedelta(weeks=week_number - 1)

def get_quarter_key_for_week(week_number):
    """Generates a quarter key (e.g., '2025-Q1') for a given week number."""
    d = get_date_for_week(week_number)
    quarter = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{quarter}"

def get_month_labels_for_weeks(weeks):
    """Returns month/year labels for the timeline similar to JS version."""
    labels = []
    current_date = START_DATE
    current_month = current_date.month - 1  # Convert to 0-11 like JS
    current_year = current_date.year
    
    # Initialize first label
    labels.append(MonthLabel(
        month=current_month,
        year=current_year,
        start_week=1,
        week_count=0
    ))

    for week in range(1, weeks + 1):
        # Check if we've crossed into a new month
        if (current_date.month - 1) != current_month:
            # Update the previous label's week count
            labels[-1].week_count = week - labels[-1].start_week
            
            # Start new label
            current_month = current_date.month - 1
            current_year = current_date.year
            labels.append(MonthLabel(
                month=current_month,
                year=current_year,
                start_week=week,
                week_count=0
            ))
        
        # Move to next week (add 7 days)
        current_date += timedelta(days=7)

    # Update the last label's week count
    if labels:
        labels[-1].week_count = weeks - labels[-1].start_week + 1

    return labels

def get_quarters_for_weeks(weeks):
    """Returns quarter info for the timeline similar to JS version."""
    quarters = []
    current_quarter_data = None

    for week in range(1, weeks + 1):
        d = get_date_for_week(week)
        quarter = (d.month - 1) // 3 + 1
        year = d.year
        quarter_key = f"{year}-Q{quarter}"

        if not current_quarter_data or quarter_key != f"{current_quarter_data.year}-Q{current_quarter_data.quarter}":
            # Start a new quarter entry
            current_quarter_data = QuarterInfo(
                quarter=quarter,
                year=year,
                start_week=week,
                week_count=1
            )
            quarters.append(current_quarter_data)
        else:
            # Continue the current quarter
            current_quarter_data.week_count += 1

    return quarters

def calculate_adjusted_hours(original_hours, complexity):
    """Calculate adjusted hours using the complexity factor."""
    adjusted = (original_hours * complexity) / COMPLEXITY_BASE
    return {
        'original': original_hours,
        'adjusted': adjusted,
        'rounded_adjusted': round(adjusted)
    }

def calculate_allocations(projects, quarterly_capacities, timeline_weeks):

    
    weekly_hours = [0] * (timeline_weeks + 1)
    project_allocations = {project['name']: [0] * (timeline_weeks + 1) for project in projects}
    default_capacity = 500 # Default capacity if a quarter's value is missing or invalid

    # First calculate end weeks for muted projects without allocation
    for project in projects:
        if project['muted']:
            project['end_week'] = project['start_week']
            project_allocations[project['name']] = [0] * (timeline_weeks + 1)

    # Then calculate allocations for non-muted projects
    for week in range(1, timeline_weeks + 1):
        active_projects = [p for p in projects if p['start_week'] <= week and p['remaining_hours'] > 0 and not p['muted']]
        
        if not active_projects:
            continue

        # Determine capacity for the current week based on its quarter
        current_quarter_key = get_quarter_key_for_week(week)
        # Get capacity for the quarter, use default if key missing or value invalid/negative
        try:
            available_capacity = int(quarterly_capacities.get(current_quarter_key, default_capacity))
            if available_capacity < 0:
                available_capacity = 0 # Capacity cannot be negative
        except (ValueError, TypeError):
            available_capacity = default_capacity # Fallback to default if conversion fails

        remaining_projects = active_projects.copy()

        while available_capacity > 0 and remaining_projects:
            num_active = len(remaining_projects)
            allocated_per_project = available_capacity / num_active if num_active > 0 else 0
            allocations_this_round = {}

            for project in remaining_projects:
                allocation = min(allocated_per_project, project['remaining_hours'])
                allocations_this_round[project['name']] = allocation

            total_allocated = 0
            completed_projects = []
            for project in remaining_projects:
                allocation = allocations_this_round[project['name']]
                if allocation > 0:
                    project_allocations[project['name']][week] += allocation
                    weekly_hours[week] += allocation
                    # Use the adjusted hours for calculations
                    project['remaining_hours'] -= allocation
                    total_allocated += allocation

                    if project['remaining_hours'] <= 0:
                        completed_projects.append(project)

            available_capacity -= total_allocated

            for completed in completed_projects:
                remaining_projects.remove(completed)

            if total_allocated == 0:
                break

    for project in projects:
        # Find the last non-zero allocation, defaulting to start_week if all zeros
        allocations = project_allocations[project['name']]
        non_zero_weeks = [i for i, h in enumerate(allocations) if h > 0]
        project['end_week'] = max(non_zero_weeks) if non_zero_weeks else project['start_week']

    return project_allocations, projects

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/capacity')
def capacity_page():
    """Serves the quarterly capacity visualization page."""
    return render_template('capacity.html')

@app.route('/api/month-labels')
def api_month_labels():
    weeks = request.args.get('weeks', default=0, type=int)
    labels = get_month_labels_for_weeks(weeks)
    return jsonify([{
        'month': label.month,
        'year': label.year,
        'startWeek': label.start_week,
        'weekCount': label.week_count
    } for label in labels])

@app.route('/api/quarters')
def api_quarters():
    weeks = request.args.get('weeks', default=0, type=int)
    quarters = get_quarters_for_weeks(weeks)
    return jsonify([{
        'quarter': q.quarter,
        'year': q.year,
        'startWeek': q.start_week,
        'weekCount': q.week_count
    } for q in quarters])

@app.route('/calculate', methods=['POST'])
def calculate():
    data = request.json
    projects = data.get('projects', [])
    quarterly_capacities = data.get('quarterly_capacities', {})
    timeline_weeks = data.get('timeline_weeks', 0)
    
    # Validate inputs
    try:
        timeline_weeks = max(0, int(timeline_weeks))
    except (ValueError, TypeError):
        timeline_weeks = 0

    # Parse capacities with defaults
    parsed_quarterly_capacities = {}
    for key, value in quarterly_capacities.items():
        try:
            parsed_quarterly_capacities[key] = max(0, int(value))
        except (ValueError, TypeError):
            parsed_quarterly_capacities[key] = DEFAULT_CAPACITY

    # Calculate adjusted hours for each project
    for project in projects:
        hours_data = calculate_adjusted_hours(
            project.get('original_hours', 0),
            project.get('complexity', 4.5)
        )
        project.update(hours_data)
        project['remaining_hours'] = hours_data['adjusted']

    # --- Group Sales Speed & Project Pre-Sales Lead Time ---
    group_sales_speeds = data.get('group_sales_speeds', {})
    DEFAULT_SALES_SPEED = 5.0 # Default monthly sales speed per group
    WEEKS_PER_MONTH_APPROX = 4.33 # Approximation for converting months/weeks

    project_allocations, updated_projects = calculate_allocations(
        projects, parsed_quarterly_capacities, timeline_weeks
    )

    month_labels = get_month_labels_for_weeks(timeline_weeks)

    # Filter projects to include only those with valid group and positive integer units for the chart
    valid_group_projects = [
        p for p in updated_projects
        if p.get('group') and p.get('units', '').isdigit() and int(p['units']) > 0
    ]

    unique_groups = { p['group'] for p in valid_group_projects }
    group_inventory_over_time = {} # Renamed from group_units_over_time
    parsed_group_sales_speeds = {} # Store the speeds used

    # Calculate sales contribution start week for each relevant project
    for p in valid_group_projects:
        try:
            lead_months = int(p.get('pre_sales_lead_months', 0))
            if lead_months < 0: lead_months = 0
        except (ValueError, TypeError):
            lead_months = 0
        p['pre_sales_lead_months'] = lead_months # Store validated value
        lead_weeks = round(lead_months * WEEKS_PER_MONTH_APPROX)
        p['sales_contribution_start_week'] = max(1, p['start_week'] - lead_weeks)

    for g in unique_groups:
        # Get and validate sales speed for the group
        try:
            group_monthly_speed = float(group_sales_speeds.get(g, DEFAULT_SALES_SPEED))
            if group_monthly_speed < 0: group_monthly_speed = 0.0
        except (ValueError, TypeError):
            group_monthly_speed = float(DEFAULT_SALES_SPEED)
        parsed_group_sales_speeds[g] = group_monthly_speed # Store the validated speed used
        group_weekly_sales_speed = group_monthly_speed / WEEKS_PER_MONTH_APPROX if WEEKS_PER_MONTH_APPROX > 0 else 0.0

        group_inventory_over_time[g] = [0.0] * timeline_weeks # Initialize with floats
        # cumulative_production = 0 # Not needed here

        projects_in_group = [p for p in valid_group_projects if p['group'] == g]

        for w in range(1, timeline_weeks + 1):
            # Calculate production for this group in this week
            # Use sales_contribution_start_week instead of start_week to account for pre-sales lead
            production_this_week = sum(
                int(p['units'])
                for p in projects_in_group
                if p['sales_contribution_start_week'] == w
            )
            # cumulative_production += production_this_week # Not needed here

            # Determine if any project in the group is actively contributing to sales this week
            is_any_project_selling = any(w >= p['sales_contribution_start_week'] for p in projects_in_group)

            # Calculate sales demand for this week based on group speed, if active
            sales_demand_this_week = group_weekly_sales_speed if is_any_project_selling else 0.0

            # Get inventory *before* adding this week's production
            inventory_before_production = group_inventory_over_time[g][w-2] if w > 1 else 0.0
            # Potential inventory available for sale *this week*
            available_for_sale = inventory_before_production + production_this_week

            # Calculate actual sales for this week
            sales_this_week = 0.0
            if sales_demand_this_week > 0:
                # Sales cannot exceed what's available
                sales_this_week = min(sales_demand_this_week, max(0.0, available_for_sale))

            # Update inventory: Previous inventory + production - sales
            current_inventory = inventory_before_production + production_this_week - sales_this_week
            group_inventory_over_time[g][w-1] = max(0.0, current_inventory) # Ensure inventory doesn't drop below 0

    return jsonify({
        'allocations': project_allocations,
        'projects': updated_projects,
        'group_units_over_time': group_inventory_over_time, # Send inventory data under the old key for now to minimize JS changes initially
        'group_sales_speeds': parsed_group_sales_speeds, # Return the speeds used
        'month_labels': [{
            'month': label.month,
            'year': label.year,
            'startWeek': label.start_week,
            'weekCount': label.week_count,
            'name': f"{['Jan','Feb','Mar','Apr','May','Jun',
                        'Jul','Aug','Sep','Oct','Nov','Dec'][label.month]} {label.year}"
        } for label in month_labels],
        'quarters': [{
            'quarter': q.quarter,
            'year': q.year,
            'startWeek': q.start_week,
            'weekCount': q.week_count
        } for q in get_quarters_for_weeks(timeline_weeks)]
    })

if __name__ == '__main__':
    app.run(debug=False, port=2000, host='0.0.0.0')
