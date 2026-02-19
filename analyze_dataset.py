import pandas as pd
import json

# Read the dataset
df = pd.read_csv('canadianized_comstock_buildings.csv')

# Get all columns that start with 'in.'
input_columns = [col for col in df.columns if col.startswith('in.')]

# Create a dictionary to store unique values for each column
column_options = {}

for col in input_columns:
    # Get unique values, excluding NaN/None
    unique_values = df[col].dropna().unique().tolist()
    
    # Sort the values (handling both numeric and string types)
    try:
        unique_values_sorted = sorted(unique_values)
    except:
        unique_values_sorted = sorted([str(v) for v in unique_values])
    
    column_options[col] = unique_values_sorted

# Save to JSON file
with open('column_options.json', 'w') as f:
    json.dump(column_options, f, indent=2)

print(f"Analyzed {len(input_columns)} input columns")
print(f"Results saved to column_options.json")

# Print summary
for col in sorted(column_options.keys()):
    print(f"\n{col}: {len(column_options[col])} unique values")
    if len(column_options[col]) <= 10:
        print(f"  Values: {column_options[col]}")
    else:
        print(f"  Sample values: {column_options[col][:5]} ... {column_options[col][-2:]}")
