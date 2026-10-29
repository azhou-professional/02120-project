# 02-120 Project Proposal

Author: Acchs Zhou (azzhou)
Using Claude

## What is your scientific question?

To what extent do relativistic effects affect GNSS satellite positioning accuracy and precision compared to a nonrelativistic Newtonian model?

Basically, I want to compare the timing precision of satellites orbiting Earth in a relativistic and nonrelativistic model. The timing difference between satellites without relativistic time dilation compensation and satellites with relativistic time dilation compensation will be calculated numerically. A theoretical positioning attempt will be made with both satellite groups, and the difference in position will also be calculated.

## What will you build to answer it?

I will build a simulation with a non-rotating planet with orbiting groups of satellites. There are several configurations of the model. The satellites have the option of having compensation for relativistic time dilation. The simulation will have a Newtonian mechanics and relativistic mechanics version. These simulations will be compared to see how much the time drifts on satellites.

These satellites will also be used in a simulated position attempt. The simulation allows the user to define number of attempts and time between attempts, and if there's significant drifting, then I can plot out the positioning error over time.

The user can choose between different planetary simulations and different orbits. The user can also choose whether the satellites compensate, and whether relativity is in the simulation to explore this question.

## How will you check your model?

There are existing papers on GPS compensating for time dilation. I will compare figures from a simulated Earth scenario with the literature values, such as from Ashby 2003 (https://link.springer.com/article/10.12942/lrr-2003-1), and if the simulation is accurate enough, I should get about the same inaccuracies.

Also, the model of nonrelativistic satellites in a relativistic environment should show positioning and timing inaccuracies after a certain amount of time due to time dilation, so there's timing drift. I can check whether the simulation is working as intended by determining whether the positioning result becomes significantly less accurate in this model compared to the others.
