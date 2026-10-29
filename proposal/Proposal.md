# 02-120 Project Proposal

Author: Acchs Zhou (azzhou)
Using Claude

## What is your scientific question?

How many GPS satellites can a user on the surface of Earth see, and how good is the positioning? Position quality depends on the geometry of visible satellites and is measured with dilution of precision (DOP). For extension, I will ask how much quality degrades when satellites fail or the sky is partly blocked.

The receiver solves for x, y, z, and its own clock bias, thus requiring four satellites.

## What will you build to answer it?

I will build a simulation hosted on a website with a non-rotating planet and orbiting groups of satellites. The satellites can be from a predefined set, such as the nominal 6-plane 24 GPS satellite constellation.

To check coverage, the Monte Carlo method will be used. It uses random times and random positions, then asks how many satellites are visible (above an elevation mask, which simulates a mountain or buildings), what is the quality measured with DOP, and the chances that a point has the sufficient number of satellites and low enough DOP (good enough positioning).

## How will you check your model?

A simple analytic method can be used to find the coverage by a single satellite, and the simulation can see if the random positions approach that probability.

The DOP can be calculated by hand and then compared with simulation DOP calculations. This can be in the verification or unit tests. "Dilution of Precision" (Langley 1999) is available.

A modeled 24 satellite constellation should have performance similar to published results from the FAA and GPS SPS Performance Standard (both which are generally available).

## Notes on revision

As per the feedback from Professor Compeau, I will be making positioning the core of the project. The relativity simulation will only return the outputs that I put in, and basically be the same as Ashby 2003.

