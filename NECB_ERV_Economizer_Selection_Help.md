# NECB ERV and Economizer Selection Help

Use the following text in the information box shown after users select an Energy Recovery Ventilator (ERV) strategy and an economizer type.

## Suggested Information Box

> **ERV Strategy**
> Display the explanation associated with the selected ERV option.
>
> **Economizer Type**
> Display the explanation associated with the selected economizer option.

## Energy Recovery Ventilator (ERV) Strategy

The selected city matters when NECB determines where energy recovery is required. Its climate data is combined with the ventilation characteristics of each system. Colder cities will generally require energy recovery on more systems.

| User selection | Explanation to display |
|---|---|
| **NECB Default (All)** | A standard NECB energy-recovery unit is added to every suitable ventilation system. "All" overrides the city-based NECB placement check, but the equipment uses NECB default performance. It transfers heat and moisture between outgoing and incoming air to reduce heating and cooling energy. |
| **Plate Heat Exchanger (All)** | A plate heat exchanger is added to every suitable ventilation system. Incoming and outgoing air remain physically separated while heat and some moisture are recovered. |
| **Plate Heat Exchanger (Existing Only)** | Energy-recovery units already required by NECB for the selected city's climate and the building's ventilation systems are changed to plate heat exchangers. No new units are added. |
| **Rotary Heat Exchanger (All)** | A rotary heat exchanger is added to every suitable ventilation system. Its rotating wheel recovers both heat and moisture from outgoing air. |
| **Rotary Heat Exchanger (Existing Only)** | Energy-recovery units already required by NECB for the selected city's climate and the building's ventilation systems are changed to rotary heat exchangers. No new units are added. |

### Short ERV Text

| User selection | Short explanation |
|---|---|
| **NECB Default (All)** | Adds a standard NECB energy-recovery unit to all suitable ventilation systems, regardless of which systems the city's climate would otherwise require. |
| **Plate Heat Exchanger (All)** | Adds a plate heat exchanger to all suitable ventilation systems. |
| **Plate Heat Exchanger (Existing Only)** | Changes city- and NECB-required energy-recovery units to plate type; no new units are added. |
| **Rotary Heat Exchanger (All)** | Adds a rotary heat exchanger to all suitable ventilation systems. |
| **Rotary Heat Exchanger (Existing Only)** | Changes city- and NECB-required energy-recovery units to rotary type; no new units are added. |

> **Meaning of "Existing Only":** This refers to energy-recovery equipment already included because of NECB requirements. It does not mean that the building itself is existing.

> **Meaning of "suitable ventilation system":** The system must have an outdoor-air intake where energy-recovery equipment can be installed.

## Economizer Type

The selected city can affect calculated cooling loads and airflow, so it can indirectly affect which systems qualify for an economizer. NECB does not choose the economizer control type from the city alone.

| User selection | Explanation to display |
|---|---|
| **NECB Default** | NECB determines which ventilation systems receive an economizer from each system's airflow and cooling size. These values may change with the selected city. Qualifying systems use NECB's default economizer control to reduce mechanical cooling with suitable outdoor air. |
| **Differential Dry Bulb** | Outdoor-air temperature is compared with return-air temperature. When outdoor air is cooler and suitable, additional outdoor air is used to reduce mechanical cooling. This setting is applied to all suitable ventilation systems. |
| **Differential Enthalpy** | Outdoor-air temperature and moisture are compared with return-air conditions. Additional outdoor air is used when it can reduce mechanical cooling without introducing excessive heat or moisture. This setting is applied to all suitable ventilation systems. |

### Short Economizer Text

| User selection | Short explanation |
|---|---|
| **NECB Default** | NECB decides where economizers are needed from system airflow and cooling size, which may vary by city. |
| **Differential Dry Bulb** | Uses outdoor-air temperature to decide when outdoor air can provide cooling. |
| **Differential Enthalpy** | Uses outdoor-air temperature and moisture to decide when outdoor air can provide cooling. |

## Example

For these selections:

- **ERV Strategy:** Rotary Heat Exchanger (Existing Only)
- **Economizer Type:** NECB Default

Display:

> **Energy Recovery Ventilator**
> Energy-recovery units already required by NECB for the selected city's climate and the building's ventilation systems will be changed to rotary heat exchangers. No new energy-recovery units will be added.
>
> **Economizer**
> NECB will determine which ventilation systems need an economizer from each system's airflow and cooling size. These values may change with the selected city. Qualifying systems will use suitable outdoor air to reduce mechanical cooling.