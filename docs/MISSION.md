# Mission & Vision

## Why Byline Exists

Byline grew out of a frustration that we suspect many projects share. In our
experience, most content management systems struggle with at least one of three
fundamental concerns: versioning, workflow, or content translation. Many
struggle with all three. And when they try to support all three at the same
time, they tend to break — sometimes obviously, or more commonly, in ways that
don't surface until you're deep into a real project with real stakes.

## The Three Pillars

We believe that content management rests on three pillars, and that these
pillars can coexist without creating mutually exclusive states or trade-offs
between one and another.

**Content translation is not interface translation.** The language you write
your content in is not the same as the language you administer your system in.
Most CMS platforms conflate these concerns. Byline separates them at the data
model level.

**Versioning should be immutable and enabled by default.** Every change creates
a new version. The current state of a document is a pointer, not a mutation.
Versioning is not a feature; it's foundational.

**Workflow should be enabled by default.** Editorial workflow should be a
first-class concern, not an afterthought bolted on through plugins or
configuration.

And these three concerns should all work together.

## Data Ownership

We believe that if you create and store content, you should be able to get it
back out. Not through an export plugin that sort of works. Not through an API
that gives you 80% of what you stored. Your data should be portable,
extractable, and workable in full and at any time.

This isn't an ideological position. It's a practical one. We've worked with
enough organisations who've been locked into platforms, or who've lost content
in migrations, or who've discovered too late that their CMS stored things in a
way that made extraction painful and lossy.

We're not trying to be the next WordPress or the next Contentful. We're not
building a platform that does everything for everyone. And we're not pretending
we have all the answers. Byline is in early beta and there's still meaningful
work ahead.

## Building in the Open

The developers of Byline have worked extensively with non-profits and NGOs,
and this work has shown us the value of certain freedoms: the freedom to own,
control, and share content that deserves to be seen. We're building in the
open because we think the problems we're solving are shared problems, and
because we'd rather build with people who understand them than in isolation.

## A Note on AI Usage in the Development of Byline

The core storage model, early UI, and schema / admin configuration system were
all developed by hand, drawing on years of experience building solutions on
top of other frameworks. Once our core model settled down, and following the
'big leap' in AI coding assistants around December 2025, we have increasingly
adopted a 'guided' approach to using LLM-based generative AI to design and
plan phases of work. It's been a remarkable journey. The marginal cost of
developing Byline has dropped significantly as a result — enough that, with
just a 2-person team, we'll likely get to a 'pretty good' v1 release on our
own.

Our hunch is that even within the rapidly evolving world of LLM-based AI, a
content management system like Byline will remain a useful tool for our work
and for the organizations we support. We're also excited by the potential for
building higher-level AI-enabled services on top of Byline. It's hard to
predict how this will all play out in a world of software development that is
changing fast, though we believe the mission and vision above — along with our
note on [Content Management in the Time of AI](./CONTENT-IN-THE-TIME-OF-AI.md)
— holds true. Time will tell whether we've guessed right, or not. ;-)
